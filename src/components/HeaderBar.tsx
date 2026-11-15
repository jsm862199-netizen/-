import React from "react";

interface HeaderBarProps {
  hasActiveReport: boolean;
  activeSection: "upload" | "timeline" | "report";
  onNavigate: (section: "upload" | "timeline" | "report") => void;
  onResetToUpload: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  hasActiveReport,
  activeSection,
  onNavigate,
  onResetToUpload,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={onResetToUpload}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 hover:text-blue-700 transition-colors cursor-pointer"
        >
          바른말 영상 분석실
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          <button
            type="button"
            onClick={() => onNavigate("upload")}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
              activeSection === "upload"
                ? "border-blue-700 text-slate-900"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            영상 업로드
          </button>
          <button
            type="button"
            onClick={() => onNavigate("timeline")}
            disabled={!hasActiveReport}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              !hasActiveReport
                ? "border-transparent text-slate-300 cursor-not-allowed"
                : activeSection === "timeline"
                ? "border-blue-700 text-slate-900 cursor-pointer"
                : "border-transparent text-slate-600 hover:text-slate-900 cursor-pointer"
            }`}
          >
            장면 타임라인
          </button>
          <button
            type="button"
            onClick={() => onNavigate("report")}
            disabled={!hasActiveReport}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              !hasActiveReport
                ? "border-transparent text-slate-300 cursor-not-allowed"
                : activeSection === "report"
                ? "border-blue-700 text-slate-900 cursor-pointer"
                : "border-transparent text-slate-600 hover:text-slate-900 cursor-pointer"
            }`}
          >
            지도 리포트
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onResetToUpload}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            새 영상 올리기
          </button>
        </div>
      </div>
    </header>
  );
};
