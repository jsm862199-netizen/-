import "dotenv/config";
import { spawn, type ChildProcess } from "child_process";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createPartFromUri, GoogleGenAI, Type } from "@google/genai";

const PORT = 3000;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB
const COMPRESSION_THRESHOLD_BYTES = 8 * 1024 * 1024; // Compress videos larger than 8MB

const uploadDir = path.join(os.tmpdir(), "student-video-uploads");
fs.mkdirSync(uploadDir, { recursive: true });

interface PendingUpload {
  uploadId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  totalChunks: number;
  receivedChunks: number;
  createdAt: number;
}

type JobStatus =
  | "compressing"
  | "uploading_to_ai"
  | "processing_video"
  | "analyzing_audio"
  | "completed"
  | "failed"
  | "cancelled";

interface AnalysisJob {
  jobId: string;
  status: JobStatus;
  progressPercent: number;
  progressMessage: string;
  report?: Record<string, unknown>;
  error?: string;
  cancelled?: boolean;
  ffmpegProcess?: ChildProcess;
  createdAt: number;
}

const pendingUploads = new Map<string, PendingUpload>();
const analysisJobs = new Map<string, AnalysisJob>();

// Periodic cleanup of stale uploads/jobs (> 30 minutes)
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;
  for (const [id, item] of pendingUploads.entries()) {
    if (now - item.createdAt > maxAge) {
      fs.promises.unlink(item.filePath).catch(() => {});
      pendingUploads.delete(id);
    }
  }
  for (const [id, job] of analysisJobs.entries()) {
    if (now - job.createdAt > maxAge) {
      analysisJobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

function inferVideoMimeType(fileName: string, providedMime?: string): string {
  if (providedMime && providedMime.startsWith("video/")) {
    return providedMime;
  }
  const ext = path.extname(fileName || "").toLowerCase();
  switch (ext) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".avi":
      return "video/x-msvideo";
    case ".mkv":
      return "video/x-matroska";
    case ".3gp":
      return "video/3gpp";
    default:
      return "video/mp4";
  }
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseFfmpegTimeSeconds(line: string): number | null {
  const match = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
  if (!match) return null;
  const hrs = Number(match[1]);
  const mins = Number(match[2]);
  const secs = Number(match[3]);
  return hrs * 3600 + mins * 60 + secs;
}

function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    proc.on("close", () => {
      const val = Number.parseFloat(out.trim());
      resolve(Number.isFinite(val) && val > 0 ? val : 0);
    });
    proc.on("error", () => resolve(0));
  });
}

function compressVideoWithFfmpeg(params: {
  inputPath: string;
  outputPath: string;
  durationSeconds: number;
  jobId: string;
  onProgress: (percent: number) => void;
}): Promise<void> {
  const { inputPath, outputPath, durationSeconds, jobId, onProgress } = params;

  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      "scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=12",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-g",
      "12",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-movflags",
      "+faststart",
      "-threads",
      "0",
      outputPath,
    ];

    const proc = spawn("ffmpeg", args);
    const job = analysisJobs.get(jobId);
    if (job) {
      job.ffmpegProcess = proc;
    }

    let stderrTail = "";
    proc.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderrTail = (stderrTail + text).slice(-1200);
      if (durationSeconds > 0) {
        const currentSec = parseFfmpegTimeSeconds(text);
        if (currentSec !== null) {
          const pct = Math.min(99, Math.max(1, Math.round((currentSec / durationSeconds) * 100)));
          onProgress(pct);
        }
      }
    });

    proc.on("close", (code) => {
      const curJob = analysisJobs.get(jobId);
      if (curJob) {
        curJob.ffmpegProcess = undefined;
        if (curJob.cancelled) {
          reject(new Error("JOB_CANCELLED"));
          return;
        }
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail.slice(-200)}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

function getSensitivityInstruction(sensitivity: string): string {
  switch (sensitivity) {
    case "strict":
      return [
        "감지 민감도: [엄격 모드]",
        "- 명확한 욕설(씨발, 개새끼, 병신, 지랄 등)뿐만 아니라 학생들 사이에서 흔히 쓰이는 비속어, 거친 은어, 초성체/변형 욕설(ㅅㅂ, ㅂㅅ, 존나, ㅈㄴ, 좆, 뒤져, 꺼져, 미친, 새끼 등)과 공격적 반말/조롱까지 빠짐없이 모두 탐지하세요.",
      ].join("\n");
    case "severe_only":
      return [
        "감지 민감도: [심각 위주 모드]",
        "- 가벼운 감탄사나 일상적 은어('존나', '미친' 등의 단순 강조)는 제외하고, 명확한 욕설, 심한 인신공격, 혐오/비하 표현, 위협적 언행만 엄선하여 탐지하세요.",
      ].join("\n");
    case "standard":
    default:
      return [
        "감지 민감도: [표준 모드]",
        "- 한국어 및 영어 욕설, 상대를 비하하거나 모욕하는 비속어, 거친 비난 표현, 화면 자막에 적힌 욕설을 균형 있게 탐지하세요. 단순 추임새나 애매한 발음은 문맥상 명확히 욕설·비속어인 경우에만 포함하세요.",
      ].join("\n");
  }
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY_MISSING");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function waitForFileActive(ai: GoogleGenAI, fileName: string, jobId: string) {
  const maxAttempts = 100; // up to ~150s
  for (let i = 0; i < maxAttempts; i++) {
    if (analysisJobs.get(jobId)?.cancelled) {
      throw new Error("JOB_CANCELLED");
    }
    const fileInfo = await ai.files.get({ name: fileName });
    if (fileInfo.state === "ACTIVE") {
      return fileInfo;
    }
    if (fileInfo.state === "FAILED") {
      throw new Error("GEMINI_FILE_PROCESSING_FAILED");
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("GEMINI_FILE_PROCESSING_TIMEOUT");
}

function cleanJsonResponse(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return trimmed;
}

async function runVideoAnalysisJob(params: {
  jobId: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  sensitivity: string;
  videoTitle: string;
  clientDuration: number;
}) {
  const {
    jobId,
    filePath,
    fileName,
    fileSizeBytes,
    mimeType,
    sensitivity,
    videoTitle,
    clientDuration,
  } = params;

  const updateJob = (patch: Partial<AnalysisJob>) => {
    const existing = analysisJobs.get(jobId);
    if (existing && !existing.cancelled) {
      analysisJobs.set(jobId, { ...existing, ...patch });
    }
  };

  let ai: GoogleGenAI;
  try {
    ai = getGeminiClient();
  } catch {
    fs.promises.unlink(filePath).catch(() => {});
    updateJob({
      status: "failed",
      progressPercent: 0,
      error:
        "Gemini API 키가 설정되지 않았습니다. Settings > Secrets 패널에서 GEMINI_API_KEY를 확인해 주세요.",
    });
    return;
  }

  let remoteFileName: string | undefined;
  let compressedPath: string | undefined;
  let analysisFilePath = filePath;
  let analysisMimeType = mimeType;
  let analysisSizeBytes = fileSizeBytes;
  let wasCompressed = false;

  try {
    const ext = path.extname(fileName).toLowerCase();
    const needsFormatNormalization = ext !== ".mp4" && ext !== ".webm";
    const shouldCompress =
      fileSizeBytes > COMPRESSION_THRESHOLD_BYTES || needsFormatNormalization;

    const probedDuration =
      clientDuration > 0 ? clientDuration : await probeDurationSeconds(filePath);

    if (shouldCompress) {
      compressedPath = path.join(uploadDir, `${jobId}-compressed.mp4`);
      updateJob({
        status: "compressing",
        progressPercent: 5,
        progressMessage: `대용량 영상(${formatMB(fileSizeBytes)})을 분석용 경량 화질로 압축하고 있습니다...`,
      });

      try {
        await compressVideoWithFfmpeg({
          inputPath: filePath,
          outputPath: compressedPath,
          durationSeconds: probedDuration,
          jobId,
          onProgress: (pct) => {
            updateJob({
              status: "compressing",
              progressPercent: Math.max(5, Math.min(95, pct)),
              progressMessage: `영상 용량 압축 중... (${pct}% · 원본 ${formatMB(fileSizeBytes)})`,
            });
          },
        });

        const stat = await fs.promises.stat(compressedPath);
        if (stat.size > 0 && (stat.size < fileSizeBytes || needsFormatNormalization)) {
          analysisFilePath = compressedPath;
          analysisMimeType = "video/mp4";
          analysisSizeBytes = stat.size;
          wasCompressed = true;
        }
      } catch (compErr) {
        if (compErr instanceof Error && compErr.message === "JOB_CANCELLED") {
          throw compErr;
        }
        console.warn("Video compression skipped due to error, using original file:", compErr);
      }
    }

    if (analysisJobs.get(jobId)?.cancelled) {
      throw new Error("JOB_CANCELLED");
    }

    updateJob({
      status: "uploading_to_ai",
      progressPercent: 45,
      progressMessage: wasCompressed
        ? `압축 완료 (${formatMB(fileSizeBytes)} → ${formatMB(analysisSizeBytes)}) · AI 분석 엔진에 전달 중...`
        : "분석 엔진으로 영상을 전달하고 있습니다...",
    });

    const uploaded = await ai.files.upload({
      file: analysisFilePath,
      config: {
        mimeType: analysisMimeType,
        displayName: videoTitle,
      },
    });

    if (!uploaded.name) {
      throw new Error("업로드된 파일 식별자를 받지 못했습니다.");
    }
    remoteFileName = uploaded.name;

    updateJob({
      status: "processing_video",
      progressPercent: 65,
      progressMessage: "영상 프레임과 오디오 트랙을 준비하고 있습니다...",
    });

    const activeFile = await waitForFileActive(ai, remoteFileName, jobId);
    if (!activeFile.uri || !activeFile.mimeType) {
      throw new Error("영상 파일 URI를 확인할 수 없습니다.");
    }

    if (analysisJobs.get(jobId)?.cancelled) {
      throw new Error("JOB_CANCELLED");
    }

    updateJob({
      status: "analyzing_audio",
      progressPercent: 82,
      progressMessage: "음성·자막에서 욕설 발화 시점과 횟수를 정밀 판별하고 있습니다...",
    });

    const promptText = [
      "당신은 학교 교사를 돕는 전문 교육 언어 분석가입니다.",
      "첨부된 학생 영상의 음성(대화, 혼잣말, 외침)과 화면(자막, 칠판/메모 글자, 공격적 제스처 등)을 처음부터 끝까지 꼼꼼하게 확인하세요.",
      "",
      getSensitivityInstruction(sensitivity),
      "",
      "요구사항:",
      "1. 영상에서 욕설·비속어·모욕적 표현이 나온 **모든 개별 발화 시점**을 빠짐없이 찾아 시간 순서대로 기록하세요.",
      "2. 같은 문장이나 연속 대화라도 서로 다른 욕설 단어나 시점이 구분되면 각각 별도 항목으로 기록해 정확한 누적 횟수를 산출하세요.",
      "3. 각 항목마다 정확한 시작 시간(startTimeSeconds, 초 단위 소수점 허용)과 종료 시간(endTimeSeconds)을 기록하세요. 타임스탬프는 실제 영상 재생 위치와 일치해야 합니다.",
      "4. detectedExpression에는 들린 실제 표현을 적고, maskedExpression에는 교사·학부모 공유용으로 첫 글자만 남기고 '*'로 가린 표현(예: 시*, 개**, ㅈ*)을 적으세요.",
      "5. fullUtterance에는 해당 장면의 전체 문맥 문장을 적고, maskedUtterance에는 비속어 부분만 '*'로 가린 문장을 적으세요.",
      "6. severity는 반드시 'mild'(가벼운 비속어/은어), 'moderate'(일반 욕설), 'severe'(심한 욕설/인신공격/혐오) 중 하나로 분류하세요.",
      "7. 욕설이 전혀 없는 경우 incidents를 빈 배열([])로 두고 긍정적인 요약을 작성하세요.",
      "8. 모든 설명, 요약, 지도 팁은 정중하고 실용적인 한국어로 작성하세요.",
    ].join("\n");

    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: [createPartFromUri(activeFile.uri, activeFile.mimeType), promptText],
      config: {
        systemInstruction:
          "당신은 한국 초·중·고등학교 교사를 지원하는 학생 언어 습관 영상 분석 전문가입니다. 영상의 오디오와 시각 정보를 정확히 동기화하여 타임스탬프와 욕설 횟수를 사실에 기반해 JSON으로 반환합니다. 추측으로 없는 욕설을 지어내지 마세요.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            videoDurationSeconds: {
              type: Type.NUMBER,
              description: "추정 또는 실제 영상 전체 길이(초)",
            },
            overallSummary: {
              type: Type.STRING,
              description: "영상 전체 언어 사용 경향에 대한 교사용 2~3문장 요약",
            },
            toneSummary: {
              type: Type.STRING,
              description: "대화 분위기, 감정 상태, 발화 맥락 요약 (1~2문장)",
            },
            counselingTips: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "교사가 학생 지도 시 활용할 수 있는 구체적 상담·지도 팁 3가지",
            },
            incidents: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startTimeSeconds: {
                    type: Type.NUMBER,
                    description: "욕설 발화 시작 시점 (초 단위 숫자)",
                  },
                  endTimeSeconds: {
                    type: Type.NUMBER,
                    description: "욕설 발화 종료 시점 (초 단위 숫자)",
                  },
                  detectedExpression: {
                    type: Type.STRING,
                    description: "감지된 욕설 또는 비속어 원문",
                  },
                  maskedExpression: {
                    type: Type.STRING,
                    description: "가림 처리(* 마스킹)된 표현",
                  },
                  fullUtterance: {
                    type: Type.STRING,
                    description: "해당 시점의 전체 발화 문장 또는 자막 문맥",
                  },
                  maskedUtterance: {
                    type: Type.STRING,
                    description: "비속어를 가림 처리한 전체 문장",
                  },
                  severity: {
                    type: Type.STRING,
                    description: "mild | moderate | severe 중 하나",
                  },
                  category: {
                    type: Type.STRING,
                    description: "예: 욕설, 비속어/은어, 인신공격/비하, 공격적 위협",
                  },
                  speakerDescription: {
                    type: Type.STRING,
                    description: "화자 묘사 (예: 화면 중앙 남학생, 화면 밖 목소리)",
                  },
                  visualCue: {
                    type: Type.STRING,
                    description: "해당 시점의 화면 상황 및 행동 묘사",
                  },
                  guidanceNote: {
                    type: Type.STRING,
                    description: "해당 장면에 대한 짧은 교사 지도 코멘트",
                  },
                },
                required: [
                  "startTimeSeconds",
                  "endTimeSeconds",
                  "detectedExpression",
                  "maskedExpression",
                  "fullUtterance",
                  "maskedUtterance",
                  "severity",
                  "category",
                  "speakerDescription",
                  "visualCue",
                  "guidanceNote",
                ],
              },
            },
          },
          required: [
            "videoDurationSeconds",
            "overallSummary",
            "toneSummary",
            "counselingTips",
            "incidents",
          ],
        },
      },
    });

    const cleanedJson = cleanJsonResponse(response.text ?? "{}");
    const parsed = JSON.parse(cleanedJson || "{}") as {
      videoDurationSeconds?: number;
      overallSummary?: string;
      toneSummary?: string;
      counselingTips?: string[];
      incidents?: Array<Record<string, unknown>>;
    };

    const rawIncidents = Array.isArray(parsed.incidents) ? parsed.incidents : [];
    const normalizedIncidents = rawIncidents
      .map((item, idx) => {
        const startRaw = Number(item.startTimeSeconds);
        const start = Number.isFinite(startRaw) && startRaw >= 0 ? startRaw : 0;
        const endRaw = Number(item.endTimeSeconds);
        const end = Number.isFinite(endRaw) && endRaw > start ? endRaw : start + 2;

        const rawSeverity = String(item.severity || "moderate").toLowerCase();
        const severity: "mild" | "moderate" | "severe" =
          rawSeverity === "mild" || rawSeverity === "severe" ? rawSeverity : "moderate";

        return {
          id: `inc-${Date.now()}-${idx}`,
          startTimeSeconds: Number(start.toFixed(1)),
          endTimeSeconds: Number(end.toFixed(1)),
          timestampDisplay: formatTimestamp(start),
          detectedExpression: String(item.detectedExpression || "").trim() || "(표현 미상)",
          maskedExpression: String(item.maskedExpression || "***").trim(),
          fullUtterance: String(item.fullUtterance || "").trim(),
          maskedUtterance: String(item.maskedUtterance || "").trim(),
          severity,
          category: String(item.category || "비속어").trim(),
          speakerDescription: String(item.speakerDescription || "화자 미상").trim(),
          visualCue: String(item.visualCue || "영상 장면 확인 필요").trim(),
          guidanceNote: String(item.guidanceNote || "").trim(),
        };
      })
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

    const severityBreakdown = normalizedIncidents.reduce(
      (acc, cur) => {
        acc[cur.severity] += 1;
        return acc;
      },
      { mild: 0, moderate: 0, severe: 0 }
    );

    const totalCount = normalizedIncidents.length;
    const overallStatus: "clean" | "caution" | "action_required" =
      totalCount === 0
        ? "clean"
        : severityBreakdown.severe > 0 || totalCount >= 4
        ? "action_required"
        : "caution";

    const durationSeconds =
      probedDuration > 0
        ? probedDuration
        : Number(parsed.videoDurationSeconds) > 0
        ? Number(parsed.videoDurationSeconds)
        : normalizedIncidents.length > 0
        ? normalizedIncidents[normalizedIncidents.length - 1].endTimeSeconds + 2
        : 0;

    updateJob({
      status: "completed",
      progressPercent: 100,
      progressMessage: "분석이 완료되었습니다.",
      report: {
        videoTitle,
        fileName,
        fileSizeBytes,
        sensitivity,
        videoDurationSeconds: durationSeconds,
        totalCount,
        severityBreakdown,
        overallStatus,
        overallSummary:
          parsed.overallSummary ||
          (totalCount === 0
            ? "영상 전체에서 감지된 욕설이나 비속어가 없습니다."
            : `총 ${totalCount}건의 욕설·비속어 발화 장면이 확인되었습니다.`),
        toneSummary:
          parsed.toneSummary || "영상 속 대화 어조 및 발화 상황을 분석했습니다.",
        counselingTips:
          Array.isArray(parsed.counselingTips) && parsed.counselingTips.length > 0
            ? parsed.counselingTips
            : [
                "해당 장면의 맥락을 학생과 함께 다시 보며 감정 표현 방식을 점검해 보세요.",
                "습관적 비속어 대신 상황을 설명하는 대체 어휘를 함께 연습해 보세요.",
                "반복 발화가 확인된 경우 학급 공동 약속과 연결해 생활 지도를 진행하세요.",
              ],
        incidents: normalizedIncidents,
        analyzedAt: new Date().toISOString(),
        compressionInfo: {
          wasCompressed,
          originalSizeBytes: fileSizeBytes,
          compressedSizeBytes: analysisSizeBytes,
        },
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "JOB_CANCELLED") {
      return;
    }

    console.error("Video analysis job error:", err);

    let friendlyError = `영상 분석 중 오류가 발생했습니다: ${message}`;
    if (
      message.includes("PERMISSION_DENIED") ||
      message.includes("API_KEY_INVALID") ||
      message.includes("403")
    ) {
      friendlyError =
        "API 키 인증에 실패했습니다. Settings > Secrets 패널에서 GEMINI_API_KEY를 확인해 주세요.";
    } else if (message.includes("RESOURCE_EXHAUSTED") || message.includes("429")) {
      friendlyError = "현재 API 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
    } else if (message === "GEMINI_FILE_PROCESSING_TIMEOUT") {
      friendlyError =
        "영상 처리 시간이 초과되었습니다. 더 짧은 영상이나 작은 용량으로 다시 시도해 주세요.";
    } else if (message === "GEMINI_FILE_PROCESSING_FAILED") {
      friendlyError =
        "지원되지 않거나 손상된 영상 형식입니다. MP4(H.264) 또는 WebM 형식으로 다시 시도해 주세요.";
    }

    updateJob({
      status: "failed",
      progressPercent: 0,
      error: friendlyError,
    });
  } finally {
    fs.promises.unlink(filePath).catch(() => {});
    if (compressedPath) {
      fs.promises.unlink(compressedPath).catch(() => {});
    }
    if (remoteFileName) {
      ai.files.delete({ name: remoteFileName }).catch(() => {});
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Step 1: Initialize chunked upload session
  app.post("/api/upload/init", (req, res) => {
    const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "video.mp4";
    const fileSize = Number(req.body?.fileSize) || 0;
    const mimeType = inferVideoMimeType(fileName, req.body?.mimeType);
    const totalChunks = Number(req.body?.totalChunks) || 1;

    if (fileSize <= 0) {
      return res.status(400).json({ error: "유효한 영상 파일이 아닙니다." });
    }
    if (fileSize > MAX_UPLOAD_BYTES) {
      return res.status(413).json({
        error: "영상 용량이 너무 큽니다. 500MB 이하의 영상 파일을 업로드해 주세요.",
      });
    }

    const uploadId = crypto.randomUUID();
    const ext = path.extname(fileName) || ".mp4";
    const filePath = path.join(uploadDir, `${uploadId}${ext}`);

    pendingUploads.set(uploadId, {
      uploadId,
      filePath,
      fileName,
      fileSize,
      mimeType,
      totalChunks,
      receivedChunks: 0,
      createdAt: Date.now(),
    });

    return res.json({ uploadId });
  });

  // Step 2: Receive binary 4MB chunk
  app.post(
    "/api/upload/chunk",
    express.raw({ type: "application/octet-stream", limit: "8mb" }),
    async (req, res) => {
      const uploadId = typeof req.query.uploadId === "string" ? req.query.uploadId : "";
      const uploadItem = pendingUploads.get(uploadId);

      if (!uploadItem) {
        return res.status(404).json({
          error: "업로드 세션을 찾을 수 없습니다. 다시 시도해 주세요.",
        });
      }

      const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bodyBuffer.length === 0) {
        return res.status(400).json({ error: "빈 청크 데이터가 전달되었습니다." });
      }

      try {
        await fs.promises.appendFile(uploadItem.filePath, bodyBuffer);
        uploadItem.receivedChunks += 1;
        return res.json({
          ok: true,
          receivedChunks: uploadItem.receivedChunks,
          totalChunks: uploadItem.totalChunks,
        });
      } catch (err) {
        console.error("Chunk append error:", err);
        return res.status(500).json({ error: "영상 조각 저장 중 오류가 발생했습니다." });
      }
    }
  );

  // Cancel pending upload
  app.post("/api/upload/cancel", (req, res) => {
    const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId : "";
    const uploadItem = pendingUploads.get(uploadId);
    if (uploadItem) {
      fs.promises.unlink(uploadItem.filePath).catch(() => {});
      pendingUploads.delete(uploadId);
    }
    return res.json({ ok: true });
  });

  // Step 3: Start asynchronous compression + analysis job
  app.post("/api/analyze/start", (req, res) => {
    const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId : "";
    const uploadItem = pendingUploads.get(uploadId);

    if (!uploadItem) {
      return res.status(404).json({
        error: "업로드된 영상 파일을 찾을 수 없습니다. 다시 업로드해 주세요.",
      });
    }

    pendingUploads.delete(uploadId);

    const sensitivity =
      typeof req.body?.sensitivity === "string" ? req.body.sensitivity : "standard";
    const videoTitle =
      typeof req.body?.videoTitle === "string" && req.body.videoTitle.trim()
        ? req.body.videoTitle.trim()
        : uploadItem.fileName;
    const clientDuration = Number(req.body?.durationSeconds) || 0;

    const jobId = crypto.randomUUID();
    analysisJobs.set(jobId, {
      jobId,
      status: "compressing",
      progressPercent: 2,
      progressMessage: "작업을 준비하고 있습니다...",
      createdAt: Date.now(),
    });

    void runVideoAnalysisJob({
      jobId,
      filePath: uploadItem.filePath,
      fileName: uploadItem.fileName,
      fileSizeBytes: uploadItem.fileSize,
      mimeType: uploadItem.mimeType,
      sensitivity,
      videoTitle,
      clientDuration,
    });

    return res.status(202).json({ jobId });
  });

  // Cancel active analysis job
  app.post("/api/analyze/cancel/:jobId", (req, res) => {
    const job = analysisJobs.get(req.params.jobId);
    if (job) {
      job.cancelled = true;
      job.status = "cancelled";
      job.progressMessage = "분석이 취소되었습니다.";
      if (job.ffmpegProcess) {
        try {
          job.ffmpegProcess.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }
    return res.json({ ok: true });
  });

  // Step 4: Poll analysis job status
  app.get("/api/analyze/status/:jobId", (req, res) => {
    const job = analysisJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        status: "failed",
        error: "분석 작업 정보를 찾을 수 없습니다. 다시 시도해 주세요.",
      });
    }

    return res.json({
      jobId: job.jobId,
      status: job.status,
      progressPercent: job.progressPercent,
      progressMessage: job.progressMessage,
      report: job.report,
      error: job.error,
    });
  });

  // Catch-all for unmatched /api/* routes so they never fall through to Vite's HTML index
  app.use("/api", (_req, res) => {
    return res.status(404).json({
      error: "요청한 API 경로를 찾을 수 없습니다. 브라우저를 새로고침(F5)한 뒤 다시 시도해 주세요.",
    });
  });

  // JSON error handler so Express never returns empty or HTML errors on /api/*
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.path.startsWith("/api/")) {
        console.error("API error middleware:", err);
        const msg = err instanceof Error ? err.message : "서버 요청 처리 오류";
        return res.status(500).json({ error: msg });
      }
      return next(err);
    }
  );

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
  server.requestTimeout = 0;
  server.headersTimeout = 120_000;
}

startServer();
