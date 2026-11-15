import React, { useState } from "react";
import { Check, Copy, Download, Printer } from "lucide-react";
import type { VideoAnalysisReport } from "../types/analysis";
import {
  downloadReportCsv,
  formatFileSize,
  formatReportText,
  formatSecondsToMMSS,
  getOverallStatusMeta,
  getSensitivityLabel,
} from "../utils/formatters";

interface AnalysisReportSectionProps {
  report: VideoAnalysisReport;
  masked: boolean;
}

export const AnalysisReportSection: React.FC<AnalysisReportSectionProps> = ({
  report,
  masked,
}) => {
  const [copied, setCopied] = useState(false);

  const statusMeta = getOverallStatusMeta(report.overallStatus);
  const durationMinutes =
    report.videoDurationSeconds > 0 ? report.videoDurationSeconds / 60 : 1;
  const perMinuteRate = (report.totalCount / durationMinutes).toFixed(1);

  const total = Math.max(report.totalCount, 1);
  const severePct = Math.round((report.severityBreakdown.severe / total) * 100);
  const moderatePct = Math.round((report.severityBreakdown.moderate / total) * 100);
  const mildPct = Math.max(0, 100 - severePct - moderatePct);

  const handleCopyReport = async () => {
    const text = formatReportText(report, masked);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored if clipboard unavailable
    }
  };

  return (
    <section id="section-report" className="space-y-6">
      {/* 4-Column Quantitative Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">총 욕설·비속어 횟수</p>
          <p className="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900">
            {report.totalCount}회
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {getSensitivityLabel(report.sensitivity)} 기준
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">수위별 발생 분포</p>
          <p className="mt-1.5 text-base sm:text-lg font-semibold font-mono tabular-nums text-slate-900">
            심각 {report.severityBreakdown.severe} · 경고 {report.severityBreakdown.moderate} · 주의{" "}
            {report.severityBreakdown.mild}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {report.totalCount > 0 ? "강도에 따른 3단계 분류" : "감지된 표현 없음"}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">분당 평균 빈도</p>
          <p className="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900">
            {perMinuteRate}회/분
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            전체 길이 {formatSecondsToMMSS(report.videoDurationSeconds)}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">종합 언어 상태</p>
          <p className={`mt-1.5 text-lg sm:text-xl font-bold ${statusMeta.textColor}`}>
            {statusMeta.label}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 truncate">{report.videoTitle}</p>
        </div>
      </div>

      {/* Summary & Counseling Guidance */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              교사용 종합 분석 및 생활 지도 리포트
            </h2>
            <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
              파일명: {report.fileName}
              {report.compressionInfo?.wasCompressed &&
                ` · 용량 최적화 ${formatFileSize(report.compressionInfo.originalSizeBytes)} → ${formatFileSize(report.compressionInfo.compressedSizeBytes)}`}
              {" · "}
              {masked ? "가림 처리(*) 기준으로 내보냅니다" : "원문 기준으로 내보냅니다"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <button
              type="button"
              onClick={() => downloadReportCsv(report, masked)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              CSV 다운로드
            </button>

            <button
              type="button"
              onClick={() => void handleCopyReport()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "복사 완료" : "리포트 텍스트 복사"}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              인쇄
            </button>
          </div>
        </div>

        {/* Severity Stacked Progress Bar */}
        {report.totalCount > 0 && (
          <div className="py-5 border-b border-slate-100">
            <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
              <span>수위별 비율</span>
              <span className="font-mono tabular-nums">
                심각 {severePct}% · 경고 {moderatePct}% · 주의 {mildPct}%
              </span>
            </div>
            <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
              {report.severityBreakdown.severe > 0 && (
                <div
                  className="bg-red-600 h-full"
                  style={{ width: `${(report.severityBreakdown.severe / total) * 100}%` }}
                />
              )}
              {report.severityBreakdown.moderate > 0 && (
                <div
                  className="bg-orange-500 h-full"
                  style={{ width: `${(report.severityBreakdown.moderate / total) * 100}%` }}
                />
              )}
              {report.severityBreakdown.mild > 0 && (
                <div
                  className="bg-amber-400 h-full"
                  style={{ width: `${(report.severityBreakdown.mild / total) * 100}%` }}
                />
              )}
            </div>
          </div>
        )}

        {/* Two-column Summary & Tips */}
        <div className="pt-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-6 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-1.5">
                영상 언어 사용 요약
              </h3>
              <p className="text-sm text-slate-700 leading-relaxed">{report.overallSummary}</p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-1.5">
                발화 어조 및 현장 맥락
              </h3>
              <p className="text-sm text-slate-700 leading-relaxed">{report.toneSummary}</p>
            </div>
          </div>

          <div className="lg:col-span-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              학생 상담 및 생활 지도 제안
            </h3>
            <ol className="space-y-2.5">
              {report.counselingTips.map((tip, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-3 text-sm text-slate-700 leading-relaxed"
                >
                  <span className="font-mono tabular-nums text-xs font-semibold text-blue-700 mt-1 shrink-0">
                    0{idx + 1}
                  </span>
                  <span>{tip}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
};
