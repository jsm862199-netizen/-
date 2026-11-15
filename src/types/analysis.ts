export type SensitivityLevel = "strict" | "standard" | "severe_only";

export type SeverityLevel = "mild" | "moderate" | "severe";

export interface ProfanityIncident {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  timestampDisplay: string;
  detectedExpression: string;
  maskedExpression: string;
  fullUtterance: string;
  maskedUtterance: string;
  severity: SeverityLevel;
  category: string;
  speakerDescription: string;
  visualCue: string;
  guidanceNote: string;
}

export interface VideoAnalysisReport {
  videoTitle: string;
  fileName: string;
  fileSizeBytes: number;
  sensitivity: SensitivityLevel;
  videoDurationSeconds: number;
  totalCount: number;
  severityBreakdown: {
    mild: number;
    moderate: number;
    severe: number;
  };
  overallStatus: "clean" | "caution" | "action_required";
  overallSummary: string;
  toneSummary: string;
  counselingTips: string[];
  incidents: ProfanityIncident[];
  analyzedAt: string;
  compressionInfo?: {
    wasCompressed: boolean;
    originalSizeBytes: number;
    compressedSizeBytes: number;
  };
}

export interface SessionVideoEntry {
  id: string;
  videoUrl: string;
  report: VideoAnalysisReport;
}
