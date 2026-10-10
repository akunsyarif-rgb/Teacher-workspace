export type PackageStatus = 'draft' | 'final';
export type ExamStatus = 'draft' | 'published' | 'closed';
export type AttemptStatus = 'active' | 'submitted' | 'expired';

export type PackageQuestionInput = { body: string; points?: number; options: string[]; correctIndex: number };
export type PackageInput = { id?: string; title: string; subject: string; status: PackageStatus; questions: PackageQuestionInput[] };

export type PackageSummary = { id: string; title: string; subject: string; status: PackageStatus; questionCount: number; updatedAt: string };
export type PackageDetail = {
  id: string; title: string; subject: string; status: PackageStatus;
  questions: { id: string; body: string; points: number; options: { id: string; label: string }[]; correctIndex: number }[];
};

export type ExamInput = {
  id?: string; packageId: string; title: string; durationMinutes: number; opensAt: string; closesAt: string;
  classNames: string[]; shuffleQuestions: boolean; shuffleOptions: boolean; showResult: boolean;
};
export type ExamSummary = {
  id: string; title: string; packageTitle: string; status: ExamStatus; durationMinutes: number; opensAt: string; closesAt: string;
  classNames: string[]; showResult: boolean; attemptCount: number;
};

export type AttemptResult = { score: number; maxScore: number; correctCount: number };
export type AttemptSummary = {
  id: string; examId: string; title: string; status: AttemptStatus; expiresAt: string; serverNow: string;
  remainingSeconds: number; result: AttemptResult | null;
};
export type StudentExam = {
  id: string; title: string; subject: string; status: ExamStatus; durationMinutes: number; opensAt: string; closesAt: string;
  attempt: { id: string; status: AttemptStatus; result: AttemptResult | null } | null;
};
export type AttemptQuestion = { id: string; position: number; body: string; points: number; options: { id: string; label: string }[] };
export type AttemptView = { attempt: AttemptSummary; questions: AttemptQuestion[]; answers: Record<string, string> };

export type IntegrityReport = { recorded: boolean; warningLevel: number; reason?: string };

export type MonitorRow = {
  studentId: string; name: string; className: string; attemptId: string | null; status: AttemptStatus | 'not_started';
  answeredCount: number; totalQuestions: number; score: number | null; maxScore: number | null; correctCount: number | null;
  leaveCount: number; maxWarningLevel: number; lastEventAt: string | null;
};
export type MonitorView = {
  exam: { id: string; title: string; status: ExamStatus; opensAt: string; closesAt: string; durationMinutes: number; serverNow: string };
  summary: { assigned: number; started: number; submitted: number; avgScore: number | null; minScore: number | null; maxScore: number | null };
  rows: MonitorRow[];
};
export type IntegrityEventRow = { id: string; eventType: string; severity: string; warningLevel: number; occurredAt: string; durationMs: number | null };
