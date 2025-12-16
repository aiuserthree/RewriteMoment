## 1) `lib/generation/promptBuilder.ts`

템플릿(`Template.bodyJson`) + Job 옵션(sliders, rewrite) → **이미지/비디오 생성에 쓸 프롬프트 패킷**을 만든다.

```ts
// lib/generation/promptBuilder.ts
import type { RewriteInput, Job, Template } from "@prisma/client";

export type GenerationTask =
  | { kind: "image"; key: string; prompt: string; refs?: string[]; aspectRatio: "9:16" | "16:9" | "1:1" }
  | { kind: "video"; key: string; prompt: string; refs?: string[]; durationSec: number; aspectRatio: "9:16" | "16:9" };

export type PromptBundle = {
  title: string;
  tasks: GenerationTask[];
  post: {
    addWatermark: boolean;
    addCaptions: boolean;
    format: "vertical_9_16";
  };
};

function sliderTone(sliders: any) {
  const realism = Number(sliders?.realism ?? 0.6);
  const intensity = Number(sliders?.intensity ?? 0.4);
  const pace = Number(sliders?.pace ?? 0.7);

  const realismText =
    realism > 0.7 ? "realistic, naturalistic" :
    realism < 0.4 ? "stylized, cinematic" : "cinematic but grounded";

  const intensityText =
    intensity > 0.7 ? "more dramatic tension (no violence)" :
    intensity < 0.4 ? "light and safe" : "moderate emotional arc";

  const paceText =
    pace > 0.7 ? "fast cuts, energetic rhythm" :
    pace < 0.4 ? "slow pacing, lingering shots" : "balanced pacing";

  return { realismText, intensityText, paceText };
}

function safetyFooter(stage: string) {
  // newlywed/early_parenting: 가족 얼굴 비디테일 규칙 고정
  if (stage === "newlywed") return "Partner appears only as silhouette / hands / shallow depth of field. No logos. No real names.";
  if (stage === "early_parenting") return "Baby face not detailed; show hands/feet/silhouette. No logos. No real names.";
  return "No logos. No famous IP. No real names.";
}

function rewriteDirective(rewrite?: RewriteInput | null) {
  if (!rewrite) return "";
  return [
    "Rewrite Moment enabled.",
    `Sanitized event: ${rewrite.sanitizedText}`,
    `Distance mode: ${rewrite.distanceMode}`,
    `Desired ending: ${rewrite.desiredEnding}`,
    "Do NOT recreate real people/places. Convert into a similar, fictional scenario with a different outcome."
  ].join("\n");
}

export function buildPromptBundle(params: {
  job: Pick<Job, "mode" | "stage" | "genre" | "slidersJson" | "rewriteEnabled">;
  templateBody: any; // Template.bodyJson
  rewrite?: RewriteInput | null;
}): PromptBundle {
  const { job, templateBody, rewrite } = params;
  const { realismText, intensityText, paceText } = sliderTone(job.slidersJson);

  const baseHeader = [
    `Genre: ${job.genre}. Stage: ${job.stage}.`,
    `Style: ${realismText}. Mood: ${intensityText}. Edit: ${paceText}.`,
    safetyFooter(job.stage),
    rewriteDirective(job.rewriteEnabled ? rewrite : null),
  ].filter(Boolean).join("\n");

  const format = "vertical_9_16" as const;
  const aspectRatio = "9:16" as const;

  const clips = templateBody?.clips ?? [];
  const tasks: GenerationTask[] = [];

  // 전략: (1) 각 clip에 대해 키프레임 이미지 1장 생성 → (2) 그 이미지 참조로 비디오 생성
  // MVP에서는 refs는 빈 배열(나중에 Identity Pack / 키프레임 URL로 채움)
  clips.forEach((clip: any, idx: number) => {
    const clipNo = clip.clip_no ?? (idx + 1);
    const durationSec = Number(clip.duration_sec ?? (job.mode === "story" ? 15 : job.mode === "quick" ? 8 : 6));

    const scene = clip.scene ?? {};
    const caption = clip.caption ? `On-screen caption (Korean, short): ${clip.caption}` : "";

    const scenePrompt = [
      baseHeader,
      `Scene location: ${scene.location ?? "unknown"}`,
      `Time: ${scene.time ?? "varies"}`,
      `Action: ${scene.action ?? ""}`,
      `Emotion: ${scene.emotion ?? ""}`,
      `Camera: ${scene.camera ?? ""}`,
      caption,
    ].filter(Boolean).join("\n");

    // image keyframe
    tasks.push({
      kind: "image",
      key: `kf_${clipNo}`,
      prompt: scenePrompt,
      refs: [],
      aspectRatio
    });

    // video clip
    tasks.push({
      kind: "video",
      key: `clip_${clipNo}`,
      prompt: scenePrompt + "\nUse the keyframe as reference if provided.",
      refs: [], // 나중에 kf URL 채워넣기
      durationSec,
      aspectRatio
    });
  });

  // Trailer는 clip 개수가 많을 수 있으니 후처리에서 이어붙이는 걸 전제로.
  const title =
    job.mode === "trailer" ? "Trailer Generation" :
    job.mode === "story" ? "Story Pack Generation" :
    "Quick Pack Generation";

  return {
    title,
    tasks,
    post: {
      addWatermark: true,
      addCaptions: true,
      format
    }
  };
}
```

---

## 2) `lib/generation/providers/google.ts` (stub 어댑터)

나중에 실제 Gemini/Veo 호출로 바꿀 수 있게, 인터페이스부터 고정.

```ts
// lib/generation/providers/google.ts
import type { GenerationTask } from "../promptBuilder";

export type GeneratedAsset = {
  key: string;
  kind: "image" | "video";
  url: string;            // 생성 결과가 저장된 URL(지금은 fake)
  meta?: Record<string, any>;
};

export type Provider = {
  generate(tasks: GenerationTask[], opts?: { jobId: string }): Promise<GeneratedAsset[]>;
};

// === MVP STUB ===
// 실제 구현에서는
// - image: "nano banana" 계열 호출
// - video: Veo 호출
// - 결과물을 S3/R2에 저장 후 URL 반환
function fakeUrl(jobId: string, key: string, kind: "image"|"video") {
  const ext = kind === "image" ? "jpg" : "mp4";
  return `https://example.com/fake/${jobId}/${key}.${ext}`;
}

export const googleProviderStub: Provider = {
  async generate(tasks, opts) {
    const jobId = opts?.jobId ?? "unknown";
    // 실제 호출 대신, task별 fake URL만 반환
    return tasks.map((t) => ({
      key: t.key,
      kind: t.kind,
      url: fakeUrl(jobId, t.key, t.kind),
      meta: {
        aspectRatio: t.aspectRatio,
        durationSec: t.kind === "video" ? (t as any).durationSec : undefined
      }
    }));
  }
};
```

> 실제 호출로 바꿀 때는 `googleProviderStub`을 `googleProvider`로 교체하고, 내부에서 API 호출 → 파일 저장(S3/R2) → URL 리턴하면 끝.

---

## 3) `lib/generation/index.ts` (provider 선택 + 실행)

Worker에서 한 번에 부르기 좋게 묶어둠.

```ts
// lib/generation/index.ts
import type { Provider } from "./providers/google";
import { googleProviderStub } from "./providers/google";
import type { GenerationTask } from "./promptBuilder";

export function getProvider(): Provider {
  // 나중에 env flag로 stub/real 전환
  const mode = process.env.GENERATION_PROVIDER ?? "stub";
  if (mode === "stub") return googleProviderStub;
  // TODO: return googleProviderReal;
  return googleProviderStub;
}

export async function runGeneration(params: { jobId: string; tasks: GenerationTask[] }) {
  const provider = getProvider();
  return provider.generate(params.tasks, { jobId: params.jobId });
}
```

---

## 4) Worker를 “템플릿→프롬프트→생성→Asset 저장”으로 교체

아까 `fakeVideoUrl`로만 저장하던 worker를 다음처럼 바꿔.

```ts
// lib/queue/worker.ts (핵심 부분만 교체)
import { Worker } from "bullmq";
import { connection } from "./client";
import { PrismaClient } from "@prisma/client";
import { buildPromptBundle } from "@/lib/generation/promptBuilder";
import { runGeneration } from "@/lib/generation";

const prisma = new PrismaClient();

type JobPayload = { jobId: string; baseJobId?: string; target?: string; clipNo?: number };

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

    // 템플릿 선택(여기서는 stage/genre/mode로 랜덤 1개)
    const templates = await prisma.template.findMany({
      where: { mode: job.mode, stage: job.stage, genre: job.genre },
      select: { bodyJson: true, signature: true }
    });
    if (!templates.length) throw new Error("No templates found");
    const picked = templates[Math.floor(Math.random() * templates.length)];

    // 프롬프트 번들 생성
    const bundle = buildPromptBundle({
      job,
      templateBody: picked.bodyJson,
      rewrite: job.rewriteInput
    });

    // Provider 실행(stub)
    const results = await runGeneration({ jobId: job.id, tasks: bundle.tasks });

    // 결과를 Asset으로 저장
    for (const r of results) {
      await prisma.asset.create({
        data: {
          jobId: job.id,
          type: r.kind, // "image" | "video"
          url: r.url,
          metadataJson: r.meta ?? {}
        }
      });
    }

    await prisma.job.update({ where: { id: jobId }, data: { status: "done" } });
    return { ok: true, templateSignature: picked.signature };
  },
  { connection }
);

worker.on("failed", async (bullJob, err) => {
  const jobId = bullJob?.data?.jobId;
  if (jobId) await prisma.job.update({ where: { id: jobId }, data: { status: "failed_video" } }).catch(() => {});
  console.error("Worker failed:", err);
});
```

---

## 5) (선택) 결과 화면에서 “클립만 보여주기” 매핑 규칙

지금은 Asset이 `image/video`로 쌓이니까, 결과 API에서:

* quick/story: `video` 중 `key`가 `clip_1~3`인 것만 뽑아 표시
* trailer: `video` 중 `clip_*` 전부를 이어붙일지(나중에), MVP는 가장 첫 `video`만 보여주기

이건 `metadataJson.key`를 저장하면 더 쉬운데, 현재는 `key`를 저장 안 했으니:

* 위 provider 반환에서 `key`를 meta에 넣고,
* asset 저장 시 `metadataJson: { key: r.key, ... }`로 바꾸면 끝.

(추천 수정)

```ts
metadataJson: { key: r.key, ...(r.meta ?? {}) }
```

---

## 6) 환경변수(로컬)

`.env`

```
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
GENERATION_PROVIDER=stub
```


