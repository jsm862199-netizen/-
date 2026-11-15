import React, { useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Play,
  Search,
} from "lucide-react";
import type { ProfanityIncident, SeverityLevel, VideoAnalysisReport } from "../types/analysis";
import { getSeverityMeta } from "../utils/formatters";

interface IncidentListPanelProps {
  report: VideoAnalysisReport;
  activeIncidentId: string | null;
  masked: boolean;
  onToggleMasked: () => void;
  onSelectIncident: (incident: ProfanityIncident) => void;
}

type FilterOption = "all" | SeverityLevel;

function SeverityIcon({ severity }: { severity: SeverityLevel }) {
  switch (severity) {
    case "severe":
      return <AlertOctagon className="w-3.5 h-3.5 text-red-600 shrink-0" />;
    case "moderate":
      return <AlertTriangle className="w-3.5 h-3.5 text-orange-600 shrink-0" />;
    case "mild":
    default:
      return <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
  }
}

export const IncidentListPanel: React.FC<IncidentListPanelProps> = ({
  report,
  activeIncidentId,
  masked,
  onToggleMasked,
  onSelectIncident,
}) => {
  const [filter, setFilter] = useState<FilterOption>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredIncidents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return report.incidents.filter((inc) => {
      if (filter !== "all" && inc.severity !== filter) return false;
      if (!q) return true;
      return (
        inc.detectedExpression.toLowerCase().includes(q) ||
        inc.fullUtterance.toLowerCase().includes(q) ||
        inc.speakerDescription.toLowerCase().includes(q) ||
        inc.category.toLowerCase().includes(q) ||
        inc.timestampDisplay.includes(q)
      );
    });
  }, [report.incidents, filter, searchQuery]);

  const filterTabs: Array<{ value: FilterOption; label: string; count: number }> = [
    { value: "all", label: "전체", count: report.totalCount },
    { value: "severe", label: "심각", count: report.severityBreakdown.severe },
    { value: "moderate", label: "경고", count: report.severityBreakdown.moderate },
    { value: "mild", label: "주의", count: report.severityBreakdown.mild },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl flex flex-col lg:max-h-[680px]">
      {/* Panel Header */}
      <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              감지된 장면 목록
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              총 {report.totalCount}회 감지 · 장면을 누르면 해당 시점으로 이동합니다
            </p>
          </div>

          <button
            type="button"
            onClick={onToggleMasked}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              masked
                ? "bg-slate-900 border-slate-900 text-white"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {masked ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {masked ? "비속어 가림 켜짐" : "원문 표시 중"}
          </button>
        </div>

        {/* Segmented Filter Tabs */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
          {filterTabs.map((tab) => {
            const active = filter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilter(tab.value)}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
                  active
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab.label} {tab.count}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="단어, 화자, 시간(01:20)으로 검색..."
            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-blue-700"
          />
        </div>
      </div>

      {/* Scrollable Scene List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {report.incidents.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-11 h-11 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-slate-900">
              감지된 욕설·비속어 장면이 없습니다
            </p>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              설정된 민감도 기준으로 바른 언어 사용이 확인되었습니다.
            </p>
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            선택한 필터 또는 검색어와 일치하는 장면이 없습니다.
          </div>
        ) : (
          filteredIncidents.map((inc) => {
            const meta = getSeverityMeta(inc.severity);
            const isActive = inc.id === activeIncidentId;
            const displayExpr = masked ? inc.maskedExpression : inc.detectedExpression;
            const displayUtt = masked ? inc.maskedUtterance : inc.fullUtterance;

            return (
              <div
                key={inc.id}
                onClick={() => onSelectIncident(inc)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectIncident(inc);
                  }
                }}
                className={`p-4 sm:px-5 transition-colors cursor-pointer ${
                  isActive ? "bg-blue-50/70" : "hover:bg-slate-50"
                }`}
              >
                {/* Row Top Metadata (Clean Unboxed Text, Zero-Pill) */}
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0 text-xs">
                    <span className="font-mono tabular-nums font-semibold text-blue-700">
                      {inc.timestampDisplay}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className={`inline-flex items-center gap-1 font-semibold ${meta.textColor}`}>
                      <SeverityIcon severity={inc.severity} />
                      {meta.label}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-600 truncate">{inc.category}</span>
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 whitespace-nowrap shrink-0">
                    <Play className="w-3 h-3 fill-current" />
                    재생
                  </span>
                </div>

                {/* Detected Expression & Utterance */}
                <p className="text-sm font-semibold text-slate-900">
                  “{displayExpr}”
                </p>
                {displayUtt && (
                  <p className="mt-1 text-xs sm:text-sm text-slate-700 leading-relaxed">
                    {displayUtt}
                  </p>
                )}

                {/* Context Metadata */}
                <p className="mt-2 text-xs text-slate-500">
                  {inc.speakerDescription} · {inc.visualCue}
                </p>

                {inc.guidanceNote && (
                  <p className="mt-1.5 text-xs text-slate-600">
                    지도 메모: {inc.guidanceNote}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
