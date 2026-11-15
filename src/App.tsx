import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { AnalysisReportSection } from "./components/AnalysisReportSection";
import { HeaderBar } from "./components/HeaderBar";
import { IncidentListPanel } from "./components/IncidentListPanel";
import { UploadWorkbench } from "./components/UploadWorkbench";
import { VideoStage } from "./components/VideoStage";
import type {
  ProfanityIncident,
  SensitivityLevel,
  SessionVideoEntry,
  VideoAnalysisReport,
} from "./types/analysis";

const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4MB chunks

async function safeParseJson<T>(response: Response): Promise<T> {
  const rawText = await response.text();
  if (!rawText || !rawText.trim()) {
    throw new Error(
      `서버에서 빈 응답이 반환되었습니다 (HTTP ${response.status}). 잠시 후 다시 시도해 주세요.`
    );
  }
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error(
      `서버 응답을 해석할 수 없습니다 (HTTP ${response.status}). 페이지를 새로고침한 뒤 다시 시도해 주세요.`
    );
  }
}

export default function App() {
  const [viewMode, setViewMode] = useState<"upload" | "workspace">("upload");
  const [activeSection, setActiveSection] = useState<"upload" | "timeline" | "report">("upload");

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [sessionHistory, setSessionHistory] = useState<SessionVideoEntry[]>([]);
  const [currentEntry, setCurrentEntry] = useState<SessionVideoEntry | null>(null);

  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null);
  const [seekRequest, setSeekRequest] = useState<{
    incident: ProfanityIncident;
    nonce: number;
  } | null>(null);
  const [masked, setMasked] = useState(true);

  const createdUrlsRef = useRef<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeUploadIdRef = useRef<string | null>(null);
  const activeJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleCancelAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const uploadId = activeUploadIdRef.current;
    if (uploadId) {
      activeUploadIdRef.current = null;
      void fetch("/api/upload/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      }).catch(() => {});
    }

    const jobId = activeJobIdRef.current;
    if (jobId) {
      activeJobIdRef.current = null;
      void fetch(`/api/analyze/cancel/${encodeURIComponent(jobId)}`, {
        method: "POST",
      }).catch(() => {});
    }

    setIsAnalyzing(false);
    setProgressPercent(0);
    setProgressMessage("");
    setErrorMessage("사용자에 의해 영상 분석이 중단되었습니다.");
  };

  const handleAnalyzeFile = async (
    file: File,
    sensitivity: SensitivityLevel,
    videoTitle: string,
    durationSeconds: number
  ) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeUploadIdRef.current = null;
    activeJobIdRef.current = null;

    setIsAnalyzing(true);
    setErrorMessage(null);
    setProgressPercent(2);
    setProgressMessage("업로드 세션을 준비하고 있습니다...");

    try {
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE_BYTES));

      // 1. Initialize chunked upload
      const initRes = await fetch("/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          totalChunks,
        }),
      });
      const initData = await safeParseJson<{ uploadId?: string; error?: string }>(initRes);
      if (!initRes.ok || !initData.uploadId) {
        throw new Error(initData.error || "업로드 초기화에 실패했습니다.");
      }

      const uploadId = initData.uploadId;
      activeUploadIdRef.current = uploadId;

      // 2. Upload 4MB chunks sequentially (0% ~ 35% of overall progress)
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        if (controller.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const start = chunkIndex * CHUNK_SIZE_BYTES;
        const end = Math.min(file.size, start + CHUNK_SIZE_BYTES);
        const chunkBlob = file.slice(start, end);

        const uploadPct = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        const overallPct = Math.max(3, Math.round((uploadPct / 100) * 35));
        setProgressPercent(overallPct);
        setProgressMessage(`영상을 분할 전송하고 있습니다... (${uploadPct}%)`);

        const chunkRes = await fetch(
          `/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            signal: controller.signal,
            body: chunkBlob,
          }
        );
        const chunkData = await safeParseJson<{ ok?: boolean; error?: string }>(chunkRes);
        if (!chunkRes.ok || !chunkData.ok) {
          throw new Error(chunkData.error || "영상 전송 중 오류가 발생했습니다.");
        }
      }

      // 3. Start async compression + analysis job
      setProgressPercent(38);
      setProgressMessage("서버에서 대용량 최적화 및 분석을 준비하고 있습니다...");

      const startRes = await fetch("/api/analyze/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          uploadId,
          sensitivity,
          videoTitle,
          durationSeconds,
        }),
      });
      activeUploadIdRef.current = null;

      const startData = await safeParseJson<{ jobId?: string; error?: string }>(startRes);
      if (!startRes.ok || !startData.jobId) {
        throw new Error(startData.error || "영상 분석 시작에 실패했습니다.");
      }

      const jobId = startData.jobId;
      activeJobIdRef.current = jobId;

      // 4. Poll job status until completed or failed
      let finalReport: VideoAnalysisReport | null = null;
      const pollStartedAt = Date.now();
      const maxWaitMs = 8 * 60 * 1000; // 8 minutes max for very large videos

      while (!finalReport) {
        if (controller.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        if (Date.now() - pollStartedAt > maxWaitMs) {
          throw new Error("분석 대기 시간이 초과되었습니다. 더 짧은 영상으로 다시 시도해 주세요.");
        }

        await new Promise((resolve) => setTimeout(resolve, 1200));

        const statusRes = await fetch(`/api/analyze/status/${encodeURIComponent(jobId)}`, {
          signal: controller.signal,
        });
        const statusData = await safeParseJson<{
          status: string;
          progressPercent?: number;
          progressMessage?: string;
          report?: VideoAnalysisReport;
          error?: string;
        }>(statusRes);

        if (statusData.progressMessage) {
          setProgressMessage(statusData.progressMessage);
        }

        // Map server stage progress (0..100) into overall UI bar (38%..100%)
        if (statusData.status === "compressing") {
          const compPct = statusData.progressPercent ?? 10;
          setProgressPercent(Math.min(65, 38 + Math.round((compPct / 100) * 27)));
        } else if (statusData.status === "uploading_to_ai") {
          setProgressPercent(70);
        } else if (statusData.status === "processing_video") {
          setProgressPercent(80);
        } else if (statusData.status === "analyzing_audio") {
          setProgressPercent(92);
        }

        if (statusData.status === "completed" && statusData.report) {
          setProgressPercent(100);
          finalReport = statusData.report;
          break;
        }

        if (statusData.status === "cancelled") {
          throw new DOMException("Aborted", "AbortError");
        }

        if (statusData.status === "failed" || !statusRes.ok) {
          throw new Error(statusData.error || "영상 분석에 실패했습니다.");
        }
      }

      activeJobIdRef.current = null;

      const objectUrl = URL.createObjectURL(file);
      createdUrlsRef.current.push(objectUrl);

      const newEntry: SessionVideoEntry = {
        id: `vid-${Date.now()}`,
        videoUrl: objectUrl,
        report: finalReport,
      };

      setSessionHistory((prev) => [newEntry, ...prev]);
      setCurrentEntry(newEntry);
      setActiveIncidentId(finalReport.incidents[0]?.id ?? null);
      setSeekRequest(null);
      setViewMode("workspace");
      setActiveSection("timeline");
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const msg = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      setErrorMessage(msg);
    } finally {
      abortControllerRef.current = null;
      activeUploadIdRef.current = null;
      activeJobIdRef.current = null;
      setIsAnalyzing(false);
      setProgressPercent(0);
      setProgressMessage("");
    }
  };

  const handleSelectHistoryEntry = (entry: SessionVideoEntry) => {
    setCurrentEntry(entry);
    setActiveIncidentId(entry.report.incidents[0]?.id ?? null);
    setSeekRequest(null);
    setViewMode("workspace");
    setActiveSection("timeline");
  };

  const handleNavigate = (section: "upload" | "timeline" | "report") => {
    if (section === "upload") {
      setViewMode("upload");
      setActiveSection("upload");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!currentEntry) return;
    setViewMode("workspace");
    setActiveSection(section);

    window.setTimeout(() => {
      const targetId = section === "timeline" ? "section-timeline" : "section-report";
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  };

  const handleSelectIncident = (incident: ProfanityIncident) => {
    setActiveIncidentId(incident.id);
    setSeekRequest({ incident, nonce: Date.now() });
  };

  const handleVideoTimeUpdate = (timeSeconds: number) => {
    if (!currentEntry) return;
    const matched = currentEntry.report.incidents.find(
      (inc) => timeSeconds >= inc.startTimeSeconds - 0.5 && timeSeconds <= inc.endTimeSeconds + 0.5
    );
    if (matched && matched.id !== activeIncidentId) {
      setActiveIncidentId(matched.id);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <HeaderBar
        hasActiveReport={currentEntry !== null}
        activeSection={viewMode === "upload" ? "upload" : activeSection}
        onNavigate={handleNavigate}
        onResetToUpload={() => handleNavigate("upload")}
      />

      <main className="flex-1">
        {viewMode === "upload" || !currentEntry ? (
          <UploadWorkbench
            isAnalyzing={isAnalyzing}
            progressPercent={progressPercent}
            progressMessage={progressMessage}
            errorMessage={errorMessage}
            sessionHistory={sessionHistory}
            onAnalyzeFile={(file, sensitivity, title, dur) => {
              void handleAnalyzeFile(file, sensitivity, title, dur);
            }}
            onCancelAnalysis={handleCancelAnalysis}
            onSelectHistoryEntry={handleSelectHistoryEntry}
          />
        ) : (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <button
                  type="button"
                  onClick={() => handleNavigate("upload")}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 mb-2 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  다른 학생 영상 올리기
                </button>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  {currentEntry.report.videoTitle}
                </h1>
              </div>

              {sessionHistory.length > 1 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="session-switch" className="text-xs text-slate-500 whitespace-nowrap">
                    분석 영상 전환
                  </label>
                  <select
                    id="session-switch"
                    value={currentEntry.id}
                    onChange={(e) => {
                      const found = sessionHistory.find((item) => item.id === e.target.value);
                      if (found) handleSelectHistoryEntry(found);
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-blue-700"
                  >
                    {sessionHistory.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.report.videoTitle} ({item.report.totalCount}회)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {isAnalyzing && (
              <div className="flex items-center gap-2.5 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>{progressMessage}</span>
              </div>
            )}

            <section
              id="section-timeline"
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
            >
              <div className="lg:col-span-7">
                <VideoStage
                  videoUrl={currentEntry.videoUrl}
                  report={currentEntry.report}
                  activeIncidentId={activeIncidentId}
                  seekRequest={seekRequest}
                  masked={masked}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onSelectIncident={handleSelectIncident}
                />
              </div>

              <div className="lg:col-span-5">
                <IncidentListPanel
                  report={currentEntry.report}
                  activeIncidentId={activeIncidentId}
                  masked={masked}
                  onToggleMasked={() => setMasked((prev) => !prev)}
                  onSelectIncident={handleSelectIncident}
                />
              </div>
            </section>

            <AnalysisReportSection report={currentEntry.report} masked={masked} />
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>바른말 영상 분석실 · 교사용 학생 언어 지도 지원 도구</span>
          <span>분석 완료 후 서버의 임시 영상 파일은 즉시 삭제됩니다.</span>
        </div>
      </footer>
    </div>
  );
}
