import type { ProfanityIncident, SeverityLevel, VideoAnalysisReport } from "../types/analysis";

export function formatSecondsToMMSS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getSeverityMeta(severity: SeverityLevel): {
  label: string;
  textColor: string;
  markerColor: string;
  barColor: string;
} {
  switch (severity) {
    case "severe":
      return {
        label: "심각",
        textColor: "text-red-700",
        markerColor: "bg-red-600",
        barColor: "bg-red-600",
      };
    case "moderate":
      return {
        label: "경고",
        textColor: "text-orange-700",
        markerColor: "bg-orange-600",
        barColor: "bg-orange-500",
      };
    case "mild":
    default:
      return {
        label: "주의",
        textColor: "text-amber-700",
        markerColor: "bg-amber-500",
        barColor: "bg-amber-500",
      };
  }
}

export function getOverallStatusMeta(status: VideoAnalysisReport["overallStatus"]): {
  label: string;
  textColor: string;
  surfaceBg: string;
} {
  switch (status) {
    case "clean":
      return {
        label: "양호 (감지 없음)",
        textColor: "text-emerald-700",
        surfaceBg: "bg-emerald-50",
      };
    case "action_required":
      return {
        label: "즉시 지도 권장",
        textColor: "text-red-700",
        surfaceBg: "bg-red-50",
      };
    case "caution":
    default:
      return {
        label: "관찰 및 지도 필요",
        textColor: "text-amber-700",
        surfaceBg: "bg-amber-50",
      };
  }
}

export function getSensitivityLabel(sensitivity: VideoAnalysisReport["sensitivity"]): string {
  switch (sensitivity) {
    case "strict":
      return "엄격 탐지";
    case "severe_only":
      return "심각 위주";
    case "standard":
    default:
      return "표준 탐지";
  }
}

function escapeCsvCell(value: string): string {
  const safe = value.replace(/"/g, '""');
  return `"${safe}"`;
}

export function downloadReportCsv(report: VideoAnalysisReport, masked: boolean): void {
  const headers = [
    "번호",
    "타임스탬프",
    "시작(초)",
    "종료(초)",
    "수위",
    "분류",
    "감지 표현",
    "발화 맥락",
    "화자",
    "화면 상황",
    "지도 메모",
  ];

  const rows = report.incidents.map((inc: ProfanityIncident, idx: number) => [
    String(idx + 1),
    inc.timestampDisplay,
    String(inc.startTimeSeconds),
    String(inc.endTimeSeconds),
    getSeverityMeta(inc.severity).label,
    inc.category,
    masked ? inc.maskedExpression : inc.detectedExpression,
    masked ? inc.maskedUtterance : inc.fullUtterance,
    inc.speakerDescription,
    inc.visualCue,
    inc.guidanceNote,
  ]);

  const csvContent =
    "\uFEFF" +
    [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
      .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeTitle = report.videoTitle.replace(/[^\w가-힣-]+/g, "_");
  link.href = url;
  link.download = `${safeTitle}_언어분석_리포트.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function formatReportText(report: VideoAnalysisReport, masked: boolean): string {
  const status = getOverallStatusMeta(report.overallStatus).label;
  const lines = [
    `[학생 영상 언어 분석 리포트]`,
    `영상명: ${report.videoTitle}`,
    `영상 길이: ${formatSecondsToMMSS(report.videoDurationSeconds)} · 민감도: ${getSensitivityLabel(report.sensitivity)}`,
    `종합 판정: ${status} · 총 감지 횟수: ${report.totalCount}회 (심각 ${report.severityBreakdown.severe} / 경고 ${report.severityBreakdown.moderate} / 주의 ${report.severityBreakdown.mild})`,
    ``,
    `1. 종합 요약`,
    report.overallSummary,
    ``,
    `2. 대화 분위기`,
    report.toneSummary,
    ``,
    `3. 감지된 장면 목록`,
  ];

  if (report.incidents.length === 0) {
    lines.push("- 감지된 욕설 및 비속어 장면이 없습니다.");
  } else {
    report.incidents.forEach((inc, idx) => {
      const expr = masked ? inc.maskedExpression : inc.detectedExpression;
      const utt = masked ? inc.maskedUtterance : inc.fullUtterance;
      lines.push(
        `${idx + 1}. [${inc.timestampDisplay}] (${getSeverityMeta(inc.severity).label} · ${inc.category}) "${expr}" — "${utt}" (${inc.speakerDescription})`
      );
    });
  }

  lines.push(``, `4. 교사 지도 제안`);
  report.counselingTips.forEach((tip, idx) => {
    lines.push(`${idx + 1}) ${tip}`);
  });

  return lines.join("\n");
}
