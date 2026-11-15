import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  FileVideo,
  Film,
  Loader2,
  Square,
  Upload,
} from "lucide-react";
import type { SensitivityLevel, SessionVideoEntry } from "../types/analysis";
import { formatFileSize, formatSecondsToMMSS, getOverallStatusMeta } from "../utils/formatters";

interface UploadWorkbenchProps {
  isAnalyzing: boolean;
  progressPercent: number;
  progressMessage: string;
  errorMessage: string | null;
  sessionHistory: SessionVideoEntry[];
  onAnalyzeFile: (
    file: File,
    sensitivity: SensitivityLevel,
    videoTitle: string,
    durationSeconds: number
  ) => void;
  onCancelAnalysis: () => void;
  onSelectHistoryEntry: (entry: SessionVideoEntry) => void;
}

const SENSITIVITY_OPTIONS: Array<{
  value: SensitivityLevel;
  label: string;
  desc: string;
}> = [
  {
    value: "standard",
    label: "표준 탐지",
    desc: "명확한 욕설과 모욕적 비속어를 균형 있게 찾아냅니다.",
  },
  {
    value: "strict",
    label: "엄격 탐지",
    desc: "가벼운 은어·초성 욕설·거친 반말 표현까지 모두 감지합니다.",
  },
  {
    value: "severe_only",
    label: "심각 위주",
    desc: "강한 욕설, 인신공격, 위협적 언어 위주로 선별합니다.",
  },
];

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const tempUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      URL.revokeObjectURL(tempUrl);
      resolve(dur);
    };
    video.onerror = () => {
      URL.revokeObjectURL(tempUrl);
      resolve(0);
    };
    video.src = tempUrl;
  });
}

export const UploadWorkbench: React.FC<UploadWorkbenchProps> = ({
  isAnalyzing,
  progressPercent,
  progressMessage,
  errorMessage,
  sessionHistory,
  onAnalyzeFile,
  onCancelAnalysis,
  onSelectHistoryEntry,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number>(0);
  const [videoTitle, setVideoTitle] = useState<string>("");
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>("standard");
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // In-browser recording state
  const [isRecordingMode, setIsRecordingMode] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopMediaStream();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const stopMediaStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const handleFileChosen = async (file: File | undefined | null) => {
    if (!file) return;
    setRecordingError(null);
    const dur = await readVideoDuration(file);
    setSelectedFile(file);
    setSelectedDuration(dur);
    if (!videoTitle.trim()) {
      setVideoTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      void handleFileChosen(dropped);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || isAnalyzing) return;
    onAnalyzeFile(
      selectedFile,
      sensitivity,
      videoTitle.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""),
      selectedDuration
    );
  };

  const startCameraPreview = async () => {
    setRecordingError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      mediaStreamRef.current = stream;
      setIsRecordingMode(true);
      setTimeout(() => {
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream;
        }
      }, 60);
    } catch {
      setRecordingError(
        "카메라 또는 마이크 접근 권한이 필요합니다. 브라우저 권한을 허용한 뒤 다시 시도해 주세요."
      );
    }
  };

  const startRecording = () => {
    if (!mediaStreamRef.current) return;
    recordedChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
    const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
      const file = new File([blob], `현장녹화_${new Date().toLocaleTimeString("ko-KR").replace(/[:\s]/g, "")}.webm`, {
        type: "video/webm",
      });
      stopMediaStream();
      setIsRecording(false);
      setIsRecordingMode(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
      await handleFileChosen(file);
    };

    recorder.start(250);
    setRecordingSeconds(0);
    setIsRecording(true);
    timerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const cancelCameraMode = () => {
    if (isRecording) stopRecording();
    stopMediaStream();
    setIsRecordingMode(false);
  };

  return (
    <section id="section-upload" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Upload & Configuration Workbench */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="mb-6">
            <p className="text-xs font-medium text-blue-700 mb-2">교사용 학생 영상 언어 검토</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight text-balance leading-snug">
              학생 영상을 올리면 욕설 장면과 횟수를 바로 찾아드립니다
            </h1>
            <p className="mt-2.5 text-sm sm:text-base text-slate-600 leading-relaxed">
              음성과 화면 자막을 함께 분석하여 욕설·비속어가 나온 정확한 시점과 누적 횟수를 정리합니다.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Optional Video Label */}
            <div>
              <label
                htmlFor="video-title-input"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                영상 제목 또는 학급 메모
              </label>
              <input
                id="video-title-input"
                type="text"
                value={videoTitle}
                onChange={(e) => setVideoTitle(e.target.value)}
                placeholder="예: 2학년 3반 모둠 토론 촬영본"
                disabled={isAnalyzing}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/15 disabled:bg-slate-50"
              />
            </div>

            {/* Sensitivity Segmented Selector */}
            <div>
              <span className="block text-sm font-medium text-slate-800 mb-2">
                탐지 민감도 설정
              </span>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
                {SENSITIVITY_OPTIONS.map((opt) => {
                  const active = sensitivity === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => setSensitivity(opt.value)}
                      className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        active
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {SENSITIVITY_OPTIONS.find((o) => o.value === sensitivity)?.desc}
              </p>
            </div>

            {/* Dropzone or In-browser Camera Recorder */}
            {isRecordingMode ? (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-950">
                <div className="relative aspect-video bg-slate-950">
                  <video
                    ref={previewVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  {isRecording && (
                    <div className="absolute top-3 left-3 px-2.5 py-1 bg-black/75 text-white text-xs font-mono tabular-nums rounded-md">
                      녹화 중 · {formatSecondsToMMSS(recordingSeconds)}
                    </div>
                  )}
                </div>
                <div className="p-4 bg-slate-900 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={cancelCameraMode}
                    className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    취소
                  </button>
                  {!isRecording ? (
                    <button
                      type="button"
                      onClick={startRecording}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      녹화 시작
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      녹화 완료 및 선택
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,video/*"
                  className="hidden"
                  onChange={(e) => {
                    void handleFileChosen(e.target.files?.[0]);
                  }}
                />
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => !isAnalyzing && fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && !isAnalyzing) {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`border border-dashed rounded-xl p-6 sm:p-8 text-center transition-colors ${
                    isAnalyzing
                      ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                      : isDragging
                      ? "border-blue-700 bg-blue-50/50 cursor-pointer"
                      : "border-slate-300 hover:border-blue-600 hover:bg-slate-50/80 cursor-pointer"
                  }`}
                >
                  {selectedFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-11 h-11 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
                        <FileVideo className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-semibold text-slate-900 break-all">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        {formatFileSize(selectedFile.size)}
                        {selectedDuration > 0 && ` · 길이 ${formatSecondsToMMSS(selectedDuration)}`}
                      </p>
                      {!isAnalyzing && (
                        <span className="mt-1 text-xs font-medium text-blue-700 underline underline-offset-4">
                          다른 영상 파일 선택하기
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2.5">
                      <div className="w-11 h-11 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          여기에 학생 영상을 끌어다 놓거나 클릭하여 선택하세요
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          MP4, MOV, WebM, AVI, MKV 지원 · 최대 500MB · 대용량 영상 자동 경량 압축
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {!isAnalyzing && (
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <span className="text-xs text-slate-500">
                      저장된 파일이 없다면 직접 촬영해 바로 테스트할 수 있습니다.
                    </span>
                    <button
                      type="button"
                      onClick={startCameraPreview}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      카메라·마이크 녹화
                    </button>
                  </div>
                )}
              </div>
            )}

            {recordingError && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{recordingError}</span>
              </div>
            )}

            {errorMessage && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Submit / Live Progress Bar */}
            <div className="pt-3 space-y-3 border-t border-slate-100">
              {isAnalyzing && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="inline-flex items-center gap-2 text-blue-700 font-medium">
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      {progressMessage || "영상을 처리하고 있습니다..."}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-700 shrink-0">
                      {progressPercent}%
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-700 transition-[width] duration-300 ease-out"
                      style={{ width: `${Math.max(2, Math.min(100, progressPercent))}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-xs text-slate-500">
                  {selectedFile && selectedFile.size > 8 * 1024 * 1024 && !isAnalyzing ? (
                    <span>
                      용량이 큰 영상은 전송 후 자동으로 경량 압축되어 지연 없이 분석됩니다.
                    </span>
                  ) : (
                    <span>업로드된 영상은 분석 완료 후 서버에서 즉시 삭제됩니다.</span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isAnalyzing && (
                    <button
                      type="button"
                      onClick={onCancelAnalysis}
                      className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      중단
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={!selectedFile || isAnalyzing}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isAnalyzing ? "분석 진행 중..." : "욕설 장면 분석 시작"}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Right Column: Analysis Workflow Guide & Session History */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">
              분석 결과에서 확인할 수 있는 항목
            </h2>
            <div className="divide-y divide-slate-100">
              <div className="pb-4 flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    01. 장면별 정확한 타임스탬프 이동
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    욕설이 들린 시점을 타임라인 마커로 표시하고, 클릭하면 해당 장면 1초 전부터 바로 재생합니다.
                  </p>
                </div>
              </div>

              <div className="py-4 flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                  <Film className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    02. 총 횟수 및 수위별(심각·경고·주의) 집계
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    영상 내 총 욕설 횟수와 분당 빈도를 계산하고, 가벼운 비속어와 심한 욕설을 구분해 보여줍니다.
                  </p>
                </div>
              </div>

              <div className="pt-4 flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    03. 비속어 가림 처리 및 지도 리포트 저장
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    학생·학부모 면담 시 원문 대신 별표(*)로 가려서 보거나 욕설 구간을 자동 음소거하여 재생할 수 있습니다.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Session History */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-slate-900">
                이번 세션 분석 기록
              </h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {sessionHistory.length}건
              </span>
            </div>

            {sessionHistory.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 border-t border-slate-100">
                아직 분석한 영상이 없습니다. 왼쪽에서 학생 영상을 선택해 분석을 시작하세요.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {sessionHistory.map((entry) => {
                  const statusMeta = getOverallStatusMeta(entry.report.overallStatus);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => onSelectHistoryEntry(entry)}
                      className="w-full py-3 flex items-center justify-between gap-4 text-left hover:bg-slate-50 px-2 -mx-2 rounded-lg transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {entry.report.videoTitle}
                        </p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                          {formatSecondsToMMSS(entry.report.videoDurationSeconds)} ·{" "}
                          <span className={statusMeta.textColor}>{statusMeta.label}</span>
                        </p>
                      </div>
                      <span className="text-sm font-semibold font-mono tabular-nums text-slate-900 shrink-0">
                        {entry.report.totalCount}회
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
