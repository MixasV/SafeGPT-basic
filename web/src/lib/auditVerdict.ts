/**
 * Parses the ChainGPT auditor verdict per .docs/audit-promt.md.
 *
 * Blocking rule: if at least one ❌ CRITICAL (❌ FAIL / DO NOT APPROVE) —
 * Deploy is blocked. If the API was unavailable (simulated) — deploy
 * proceeds as "Deploy without verification".
 */

export interface AuditVerdict {
  critical: boolean;
  doNotApprove: boolean;
  summary: "SAFE_TO_APPROVE" | "REVIEW_REQUIRED" | "DO_NOT_APPROVE" | "UNKNOWN";
}

export function parseAuditVerdict(markdown: string): AuditVerdict {
  const upper = markdown.toUpperCase();
  const critical =
    markdown.includes("❌") || /CRITICAL/i.test(markdown) && /FAIL|DO NOT APPROVE/.test(upper) || upper.includes("DO NOT APPROVE");
  const doNotApprove = upper.includes("DO NOT APPROVE");
  let summary: AuditVerdict["summary"] = "UNKNOWN";
  if (doNotApprove) summary = "DO_NOT_APPROVE";
  else if (upper.includes("SAFE TO APPROVE")) summary = "SAFE_TO_APPROVE";
  else if (upper.includes("REVIEW REQUIRED")) summary = "REVIEW_REQUIRED";
  return { critical, doNotApprove, summary };
}

const STORAGE_KEY = "safegpt_audit_verdict";

export function saveAuditVerdict(markdown: string, configHash: string, simulated: boolean): AuditVerdict {
  const verdict = parseAuditVerdict(markdown);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...verdict, configHash, simulated, at: Date.now() }));
  } catch { /* storage unavailable */ }
  return verdict;
}

export function loadAuditVerdict(): (AuditVerdict & { configHash: string; simulated: boolean }) | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuditVerdict & { configHash: string; simulated: boolean };
  } catch {
    return null;
  }
}