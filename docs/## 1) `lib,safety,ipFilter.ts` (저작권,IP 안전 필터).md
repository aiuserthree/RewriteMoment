## 1) `lib/safety/ipFilter.ts` (저작권/IP 안전 필터)

```ts
// lib/safety/ipFilter.ts
export type IpFilterResult = {
  ok: boolean;
  replacedText: string;
  hits: string[];
};

// MVP: 금칙어는 운영하면서 확장(작품명/캐릭터명/브랜드/로고 등)
const BANNED_TERMS = [
  "해리포터", "마블", "디즈니", "넷플릭스", "지브리", "나루토", "원피스",
  "아이언맨", "스파이더맨", "스타워즈", "포켓몬"
];

// "치환"은 장르 키워드로(직접 작품 언급 제거)
function replaceBannedToGeneric(text: string): { text: string; hits: string[] } {
  let out = text;
  const hits: string[] = [];
  for (const term of BANNED_TERMS) {
    if (out.includes(term)) {
      hits.push(term);
      // 작품별 치환보단 일괄 "오리지널 장르 표현"으로
      out = out.split(term).join("오리지널 장르풍");
    }
  }
  return { text: out, hits };
}

export function ipFilter(text: string): IpFilterResult {
  const { text: replacedText, hits } = replaceBannedToGeneric(text);
  // MVP에서는 "완전 차단"보단 치환 후 통과(운영 중 강화 가능)
  return { ok: true, replacedText, hits };
}
```

---

## 2) `lib/safety/sanitize.ts` (Rewrite Moment 입력 정제/마스킹)

* 목표: “직접 재현”을 막고, **식별 가능한 정보(실명/주소/연락처/학교/회사 등)**를 줄여서 **유사 상황(상징화)**로 변환 가능한 입력으로 만들기.

```ts
// lib/safety/sanitize.ts
import { ipFilter } from "./ipFilter";

export type DistanceMode = "symbolic" | "similar" | "quite_similar";
export type DesiredEnding = "recovery" | "growth" | "reconcile" | "self_protect" | "new_start" | "comedy";

export type SanitizeOutput = {
  sanitizedText: string;
  flags: {
    hadIpTerms: boolean;
    hadPii: boolean;
    highRisk: boolean;
  };
  notes: string[];
};

// 간단 PII 룰(운영하며 강화)
const RE_PHONE = /\b01[016789]-?\d{3,4}-?\d{4}\b/g;
const RE_EMAIL = /\b[\w.\-+]+@[\w.\-]+\.\w+\b/g;
const RE_URL = /\bhttps?:\/\/\S+\b/g;
const RE_ACCOUNTLIKE = /\b\d{2,4}-\d{2,4}-\d{2,4}-\d{2,4}\b/g; // 대충 계좌/카드류 패턴

// 위험 신호(자해/학대/폭력 등) — 구체 묘사 방지용 “플래그”
const HIGH_RISK_TERMS = [
  "자살", "자해", "죽고", "죽을", "목숨", "학대", "강간", "성폭행", "폭행", "살인"
];

function maskPii(text: string): { text: string; hadPii: boolean } {
  let out = text;
  const before = out;

  out = out.replace(RE_PHONE, "[전화번호]");
  out = out.replace(RE_EMAIL, "[이메일]");
  out = out.replace(RE_URL, "[링크]");
  out = out.replace(RE_ACCOUNTLIKE, "[민감번호]");

  // 주소/학교/회사명은 룰만으로 완벽히 못 잡으니,
  // MVP에서는 사용자가 실명/고유명사 입력 시 “가상 처리” 안내 + LLM 정제 단계에서 추가 제거 권장.
  const hadPii = out !== before;
  return { text: out, hadPii };
}

function detectHighRisk(text: string): boolean {
  const lower = text.toLowerCase();
  return HIGH_RISK_TERMS.some(t => lower.includes(t));
}

export function sanitizeRewriteInput(rawText: string): SanitizeOutput {
  const notes: string[] = [];
  let text = (rawText || "").trim();

  if (!text) {
    return { sanitizedText: "", flags: { hadIpTerms: false, hadPii: false, highRisk: false }, notes: ["empty"] };
  }

  // 1) IP 치환
  const ip = ipFilter(text);
  text = ip.replacedText;
  const hadIpTerms = ip.hits.length > 0;
  if (hadIpTerms) notes.push(`ip_terms_replaced:${ip.hits.join(",")}`);

  // 2) PII 마스킹
  const pii = maskPii(text);
  text = pii.text;
  const hadPii = pii.hadPii;
  if (hadPii) notes.push("pii_masked");

  // 3) 고위험 플래그
  const highRisk = detectHighRisk(text);
  if (highRisk) notes.push("high_risk_detected");

  // 4) 길이 제한(프롬프트 폭주 방지)
  if (text.length > 500) {
    text = text.slice(0, 500);
    notes.push("truncated_500");
  }

  return {
    sanitizedText: text,
    flags: { hadIpTerms, hadPii, highRisk },
    notes
  };
}
```

---

## 3) `lib/safety/rewriteSpec.ts` (Rewrite 변환 JSON 스키마/타입)

LLM(나중에 Gemini 등)로 “유사상황/상징화/엔딩목표”를 만들 때 **항상 이 JSON으로** 받게 해.

```ts
// lib/safety/rewriteSpec.ts
import type { DistanceMode, DesiredEnding } from "./sanitize";

export type RewritePlan = {
  sanitized_event: string;        // 가상화된 한 줄 사건
  core_emotion: Array<"shame"|"regret"|"anger"|"fear"|"sadness"|"relief"|"hope">;
  metaphor_scene: string;         // 유사 상황(상징화) 설명
  rewrite_goal: string;           // 선택한 결말 방향
  do_not_include: string[];       // 금지 요소
  distance_mode: DistanceMode;
  desired_ending: DesiredEnding;
};
```

> MVP에서는 LLM 호출 없이도, `sanitizeRewriteInput` 결과를 그대로 “metaphor_scene 템플릿”에 꽂아도 됨. (나중에 고도화)

---

## 4) `lib/queue/client.ts` (BullMQ 큐 생성)

```ts
// lib/queue/client.ts
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

export const jobQueue = new Queue("video-jobs", { connection });

// Worker도 이 connection을 재사용할 수 있게 export
export { connection };
```

---

## 5) `lib/queue/worker.ts` (Worker 뼈대: 지금은 더미 영상 생성)

* **실제 모델 호출은 나중에** 붙이고, 지금은 “가짜 결과 영상 URL”을 Asset에 저장해서 end-to-end를 먼저 뚫는다.

```ts
// lib/queue/worker.ts
import { Worker } from "bullmq";
import { connection } from "./client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type JobPayload = {
  jobId: string;
};

function fakeVideoUrl(jobId: string, idx: number) {
  // 실제론 S3/R2 업로드 URL로 대체
  return `https://example.com/fake/${jobId}/clip_${idx}.mp4`;
}

function fakeThumbUrl(jobId: string, idx: number) {
  return `https://example.com/fake/${jobId}/thumb_${idx}.jpg`;
}

export const worker = new Worker<JobPayload>(
  "video-jobs",
  async (bullJob) => {
    const { jobId } = bullJob.data;

    await prisma.job.update({ where: { id: jobId }, data: { status: "running" } });

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { rewriteInput: true }
    });
    if (!job) throw new Error("Job not found");

    // TODO: 여기서 템플릿 불러와 스토리보드 → 이미지 → 영상 생성
    // MVP: mode별 결과 자산만 생성해둔다.
    const assets: Array<{ type: string; url: string; metadataJson?: any }> = [];

    if (job.mode === "quick" || job.mode === "story") {
      // 3 clips
      for (let i = 1; i <= 3; i++) {
        assets.push({ type: "video", url: fakeVideoUrl(jobId, i), metadataJson: { clipNo: i } });
        assets.push({ type: "thumb", url: fakeThumbUrl(jobId, i), metadataJson: { clipNo: i } });
      }
    } else {
      // trailer 1
      assets.push({ type: "video", url: fakeVideoUrl(jobId, 1), metadataJson: { trailer: true } });
      assets.push({ type: "thumb", url: fakeThumbUrl(jobId, 1), metadataJson: { trailer: true } });
    }

    // DB 저장
    for (const a of assets) {
      await prisma.asset.create({
        data: {
          jobId,
          type: a.type,
          url: a.url,
          metadataJson: a.metadataJson
        }
      });
    }

    await prisma.job.update({ where: { id: jobId }, data: { status: "done" } });

    return { ok: true };
  },
  { connection }
);

worker.on("failed", async (bullJob, err) => {
  const jobId = bullJob?.data?.jobId;
  if (jobId) {
    await prisma.job.update({ where: { id: jobId }, data: { status: "failed_video" } }).catch(() => {});
  }
  console.error("Worker failed:", err);
});
```

**실행(로컬):**

* `node --loader ts-node/esm lib/queue/worker.ts`
  또는 `tsx lib/queue/worker.ts` (tsx 사용 추천)

---

## 6) `lib/credits/ledger.ts` (크레딧 장부 + idemKey 중복 차감 방지)

정책(확정):

* 무료 Quick: 크레딧 차감 없음(무료 제한은 rate limit)
* 유료:

  * Story = 2
  * Trailer = 5
  * Rewrite = +1
  * 재생성: Story 클립 = 1 (초기엔 단순하게 1로 고정 추천)
  * 재생성: Trailer 장면 = 1

```ts
// lib/credits/ledger.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export type CreditReason =
  | "PURCHASE"
  | "STORY_CREATE"
  | "TRAILER_CREATE"
  | "REWRITE_ADD"
  | "STORY_REGEN_CLIP"
  | "TRAILER_REGEN_SCENE";

export async function applyCreditDelta(params: {
  userId: string;
  delta: number;         // 음수=차감, 양수=충전
  reason: CreditReason;
  refJobId?: string;
  idemKey: string;       // 중복 방지 키
}) {
  // idemKey unique로 중복 차감 방지
  return prisma.creditLedger.create({
    data: {
      userId: params.userId,
      delta: params.delta,
      reason: params.reason,
      refJobId: params.refJobId,
      idemKey: params.idemKey
    }
  });
}

// 현재 크레딧(ledger 합산)
export async function getCreditBalance(userId: string): Promise<number> {
  const rows = await prisma.creditLedger.findMany({
    where: { userId },
    select: { delta: true }
  });
  return rows.reduce((sum, r) => sum + r.delta, 0);
}

// 차감 헬퍼
export async function chargeForCreate(params: {
  userId: string;
  jobId: string;
  mode: "quick" | "story" | "trailer";
  rewriteEnabled: boolean;
}) {
  // quick은 무료(차감 없음). 무료 제한은 별도 rate-limit로.
  if (params.mode === "quick") return;

  const base = params.mode === "story" ? 2 : 5;
  const total = base + (params.rewriteEnabled ? 1 : 0);

  // idemKey는 "create:{jobId}" 같은 형태로 고정
  await applyCreditDelta({
    userId: params.userId,
    delta: -base,
    reason: params.mode === "story" ? "STORY_CREATE" : "TRAILER_CREATE",
    refJobId: params.jobId,
    idemKey: `create:${params.jobId}:${params.mode}`
  });

  if (params.rewriteEnabled) {
    await applyCreditDelta({
      userId: params.userId,
      delta: -1,
      reason: "REWRITE_ADD",
      refJobId: params.jobId,
      idemKey: `rewrite:${params.jobId}`
    });
  }

  return total;
}
```

---

## 7) `app/api/jobs/route.ts` (Job 생성: 템플릿 선택 + 크레딧 차감 + 큐 enqueue)

> 인증은 프로젝트 상황마다 다르니, 아래는 `userId`를 body로 받는 MVP 형태. (NextAuth/Clerk 붙이면 서버에서 userId 가져오게 바꾸면 됨)

```ts
// app/api/jobs/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { jobQueue } from "@/lib/queue/client";
import { sanitizeRewriteInput } from "@/lib/safety/sanitize";
import { chargeForCreate, getCreditBalance } from "@/lib/credits/ledger";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  const body = await req.json();

  const userId = body.userId as string;
  const mode = body.mode as "quick"|"story"|"trailer";
  const stage = body.stage as string;
  const genre = body.genre as string;
  const slidersJson = body.slidersJson ?? { realism: 0.6, intensity: 0.4, pace: 0.7 };

  const rewriteEnabled = Boolean(body.rewriteEnabled);
  const rewriteRawText = (body.rewriteRawText ?? "") as string;
  const distanceMode = (body.distanceMode ?? "similar") as string;
  const desiredEnding = (body.desiredEnding ?? "growth") as string;

  // 1) 템플릿 선택
  const templates = await prisma.template.findMany({
    where: { mode, stage, genre },
    select: { id: true, signature: true, bodyJson: true }
  });
  if (!templates.length) {
    return NextResponse.json({ error: "No templates found for selection" }, { status: 400 });
  }
  const picked = templates[Math.floor(Math.random() * templates.length)];

  // 2) Job 생성
  const job = await prisma.job.create({
    data: {
      userId,
      mode,
      stage,
      genre,
      slidersJson,
      rewriteEnabled,
      status: "queued"
    }
  });

  // 3) Rewrite 저장(선택)
  if (rewriteEnabled && rewriteRawText.trim()) {
    const sanitized = sanitizeRewriteInput(rewriteRawText);
    await prisma.rewriteInput.create({
      data: {
        jobId: job.id,
        rawText: rewriteRawText,
        sanitizedText: sanitized.sanitizedText,
        distanceMode,
        desiredEnding
      }
    });
  }

  // 4) 유료 크레딧 차감(quick은 무료)
  if (mode !== "quick") {
    const balance = await getCreditBalance(userId);
    const needed = (mode === "story" ? 2 : 5) + (rewriteEnabled ? 1 : 0);
    if (balance < needed) {
      // 크레딧 부족이면 Job 롤백하거나 상태를 canceled로 두는 방식 택1
      await prisma.job.update({ where: { id: job.id }, data: { status: "failed_credit" } });
      return NextResponse.json({ error: "Not enough credits", needed, balance }, { status: 402 });
    }
    await chargeForCreate({ userId, jobId: job.id, mode, rewriteEnabled });
  }

  // 5) 큐 enqueue (worker가 처리)
  await jobQueue.add("generate", { jobId: job.id }, { removeOnComplete: 1000, removeOnFail: 1000 });

  return NextResponse.json({
    jobId: job.id,
    templateSignature: picked.signature,
    status: "queued"
  });
}
```

---

## 8) `app/api/jobs/[jobId]/route.ts` (결과 조회)

```ts
// app/api/jobs/[jobId]/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(_: Request, { params }: { params: { jobId: string } }) {
  const job = await prisma.job.findUnique({
    where: { id: params.jobId },
    include: { assets: true, rewriteInput: true }
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: job.id,
    mode: job.mode,
    stage: job.stage,
    genre: job.genre,
    status: job.status,
    assets: job.assets,
    rewrite: job.rewriteInput
  });
}
```

---

## 9) `app/api/jobs/[jobId]/regenerate/route.ts` (재생성 엔드포인트 뼈대)

MVP에서는 일단 “클립 번호/장면 번호”를 받아서 **같은 Job에 Asset을 추가**하거나, 새 Job을 파생 생성(추천)을 할 수 있어.
바이럴 서비스는 **파생 Job(retryJob)**가 추적/정산이 쉬워서 추천.

```ts
// app/api/jobs/[jobId]/regenerate/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { jobQueue } from "@/lib/queue/client";
import { applyCreditDelta, getCreditBalance } from "@/lib/credits/ledger";

const prisma = new PrismaClient();

export async function POST(req: Request, { params }: { params: { jobId: string } }) {
  const body = await req.json();
  const userId = body.userId as string;

  const target = body.target as "story_clip" | "trailer_scene" | "rewrite_only";
  const clipNo = body.clipNo as number | undefined;

  const baseJob = await prisma.job.findUnique({ where: { id: params.jobId } });
  if (!baseJob) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 크레딧 차감(유료만)
  let cost = 0;
  let reason: any = null;

  if (baseJob.mode === "story") {
    cost = 1; reason = "STORY_REGEN_CLIP";
  } else if (baseJob.mode === "trailer") {
    cost = 1; reason = "TRAILER_REGEN_SCENE";
  } else {
    return NextResponse.json({ error: "Quick mode regeneration disabled in MVP" }, { status: 400 });
  }

  const balance = await getCreditBalance(userId);
  if (balance < cost) return NextResponse.json({ error: "Not enough credits", cost, balance }, { status: 402 });

  // idemKey로 중복 차감 방지
  await applyCreditDelta({
    userId,
    delta: -cost,
    reason,
    refJobId: baseJob.id,
    idemKey: `regen:${baseJob.id}:${target}:${clipNo ?? "na"}`
  });

  // 파생 Job 생성(추천)
  const retryJob = await prisma.job.create({
    data: {
      userId,
      mode: baseJob.mode as any,
      stage: baseJob.stage,
      genre: baseJob.genre,
      slidersJson: baseJob.slidersJson,
      rewriteEnabled: baseJob.rewriteEnabled,
      status: "queued"
    }
  });

  await jobQueue.add("regenerate", {
    jobId: retryJob.id,
    // worker가 target/clipNo 참고해서 해당 부분만 재생성하도록(지금은 stub)
    baseJobId: baseJob.id,
    target,
    clipNo
  } as any);

  return NextResponse.json({ retryJobId: retryJob.id, status: "queued" });
}
```

