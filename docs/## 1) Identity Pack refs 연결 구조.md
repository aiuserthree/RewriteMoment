## 1) Identity Pack refs 연결 구조

### 1-1) Prisma에 IdentityPack 테이블 추가 (권장)

`prisma/schema.prisma`에 추가:

```prisma
model IdentityPack {
  id          String   @id @default(cuid())
  jobId       String
  job         Job      @relation(fields: [jobId], references: [id])
  stage       String
  refJson     Json     // { refs: [{key,url,meta...}] }
  createdAt   DateTime @default(now())

  @@unique([jobId, stage])
}
```

마이그레이션 후.

### 1-2) Identity Pack 생성 단계 추가: `lib/generation/identity.ts`

* 업로드한 사용자 사진(나중에 S3 URL)을 참조로
* stage 버전의 “기준 이미지 6장”을 먼저 만들고 refs로 저장
* MVP stub: fake image URL 6개 생성

```ts
// lib/generation/identity.ts
import { PrismaClient } from "@prisma/client";
import { runGeneration } from "@/lib/generation";
import type { GenerationTask } from "./promptBuilder";

const prisma = new PrismaClient();

export async function ensureIdentityPack(params: {
  jobId: string;
  stage: string;
  userPhotoUrls: string[]; // 업로드 이미지 URL들
}) {
  const existing = await prisma.identityPack.findUnique({
    where: { jobId_stage: { jobId: params.jobId, stage: params.stage } }
  });
  if (existing) return existing;

  const tasks: GenerationTask[] = [];

  // stage별 아이덴티티 지시문(얼굴 일관성 목적)
  const stageLine =
    params.stage === "teen" ? "Create a teenage version of the same person, consistent identity." :
    params.stage === "twenties" ? "Create a 20s version of the same person, consistent identity." :
    params.stage === "newlywed" ? "Create a newlywed-life look of the same person, consistent identity." :
    "Create a parent-life look of the same person, consistent identity.";

  const basePrompt = [
    "Identity Pack generation.",
    stageLine,
    "No logos. No famous IP. No real names.",
    "Keep face identity consistent across outputs.",
  ].join("\n");

  for (let i=1; i<=6; i++) {
    tasks.push({
      kind: "image",
      key: `id_${params.stage}_${i}`,
      prompt: basePrompt + `\nVariation: ${i} (different lighting/angle but same identity)`,
      refs: params.userPhotoUrls, // 실제 구현 시 이 refs를 provider가 참조하도록
      aspectRatio: "9:16"
    });
  }

  const results = await runGeneration({ jobId: params.jobId, tasks });

  const refJson = {
    refs: results.map(r => ({
      key: r.key,
      url: r.url,
      meta: r.meta ?? {}
    }))
  };

  return prisma.identityPack.create({
    data: { jobId: params.jobId, stage: params.stage, refJson }
  });
}
```

### 1-3) promptBuilder에 refs 주입

`buildPromptBundle`에서 `refs`를 IdentityPack refs로 넣어주면 됨.

`lib/generation/promptBuilder.ts`에 파라미터 추가:

* `identityRefs?: string[]`

그리고 tasks 생성에서:

* image task refs: `identityRefs`
* video task refs: `identityRefs + [keyframeUrl]` (나중에)

간단 패치 예시:

```ts
// buildPromptBundle(...) 내부
const identityRefs = params.identityRefs ?? [];

tasks.push({
  kind: "image",
  key: `kf_${clipNo}`,
  prompt: scenePrompt,
  refs: identityRefs,
  aspectRatio
});

tasks.push({
  kind: "video",
  key: `clip_${clipNo}`,
  prompt: scenePrompt + "\nUse identity references to keep the same person.",
  refs: identityRefs,
  durationSec,
  aspectRatio
});
```

### 1-4) Worker에서 IdentityPack 먼저 생성 후 번들 생성

worker에서 job을 읽은 뒤:

```ts
import { ensureIdentityPack } from "@/lib/generation/identity";

// ...
// TODO: userPhotoUrls를 실제 업로드 URL에서 가져오도록(지금은 stub 배열)
const userPhotoUrls = ["https://example.com/fake/userphoto_1.jpg"];

const idPack = await ensureIdentityPack({ jobId: job.id, stage: job.stage, userPhotoUrls });
const identityRefs = (idPack.refJson as any).refs.map((r: any) => r.url);

const bundle = buildPromptBundle({
  job,
  templateBody: picked.bodyJson,
  rewrite: job.rewriteInput,
  identityRefs
});
```

---

## 2) ffmpeg postprocess 스텁 (Trailer 이어붙이기)

### 2-1) `lib/postprocess/ffmpeg.ts`

* 지금은 “stub”로 두되 구조만 잡자.
* 나중에 실제로는: results에서 trailer용 clip들을 다운로드 → ffmpeg concat → 업로드

```ts
// lib/postprocess/ffmpeg.ts
export async function concatVideos(params: {
  inputUrls: string[];
  outputKey: string;
}): Promise<{ url: string }> {
  // MVP STUB: 실제 ffmpeg 작업 없이 첫 영상 URL을 대표로 반환
  // 추후 구현:
  // 1) inputUrls 다운로드
  // 2) ffmpeg concat demuxer로 합치기
  // 3) S3/R2 업로드 후 URL 반환
  const url = params.inputUrls[0] ?? "";
  return { url };
}
```

### 2-2) Worker에서 Trailer면 “대표 영상 1개” Asset으로 저장

* provider가 여러 `clip_*` video를 만들면, concat 결과를 `video_final`로 저장.

worker에 추가:

```ts
import { concatVideos } from "@/lib/postprocess/ffmpeg";

// results 저장 후, trailer일 때:
if (job.mode === "trailer") {
  const trailerClips = results
    .filter(r => r.kind === "video" && r.key.startsWith("clip_"))
    .map(r => r.url);

  const merged = await concatVideos({ inputUrls: trailerClips, outputKey: `final_${job.id}` });

  await prisma.asset.create({
    data: { jobId: job.id, type: "video", url: merged.url, metadataJson: { key: "video_final", trailer: true } }
  });
}
```

> MVP에서 트레일러는 결과 화면에서 `video_final`만 보여주면 끝.

---

## 3) Rewrite를 Clip3에만 강제 적용(override)

핵심: 템플릿 bodyJson은 그대로 두되,

* quick/story 모드에서 **clip_no=3**의 `scene.action`/`caption`에 rewrite 지시를 섞는다.

### 3-1) `lib/generation/rewriteOverride.ts`

```ts
// lib/generation/rewriteOverride.ts
import type { RewriteInput } from "@prisma/client";

export function applyRewriteToEndingClip(templateBody: any, rewrite: RewriteInput | null) {
  if (!rewrite) return templateBody;
  const cloned = structuredClone(templateBody);

  const clips = cloned.clips ?? [];
  for (const clip of clips) {
    if (clip.clip_no === 3 && (clip.role === "ending" || clip.role === "ending_scene" || true)) {
      // action/caption override (직접 재현 금지 문구 포함)
      clip.scene = clip.scene ?? {};
      clip.scene.action =
        `Rewrite ending based on a fictional similar scenario.\n` +
        `Sanitized event: ${rewrite.sanitizedText}\n` +
        `Distance: ${rewrite.distanceMode}, Desired ending: ${rewrite.desiredEnding}\n` +
        `Do not include real names/places. No violence. Provide a different outcome.`;

      // 캡션도 엔딩 톤에 맞춰 짧게
      const endMap: Record<string,string> = {
        recovery: "괜찮아, 다시 숨 쉬자",
        growth: "이건 끝이 아니라 시작",
        reconcile: "말하면 풀릴 때도 있어",
        self_protect: "나는 나를 지킬 거야",
        new_start: "이제 다른 길로",
        comedy: "결국… 웃고 말았다"
      };
      clip.caption = endMap[rewrite.desiredEnding] ?? "다르게, 더 나답게";
    }
  }

  return cloned;
}
```

### 3-2) Worker에서 번들 생성 전에 override 적용

```ts
import { applyRewriteToEndingClip } from "@/lib/generation/rewriteOverride";

// 템플릿 선택 후
let body = picked.bodyJson;

if ((job.mode === "quick" || job.mode === "story") && job.rewriteEnabled) {
  body = applyRewriteToEndingClip(body, job.rewriteInput);
}

const bundle = buildPromptBundle({
  job,
  templateBody: body,
  rewrite: job.rewriteInput,
  identityRefs
});
```

> 이렇게 하면 “Rewrite는 무조건 엔딩(Clip3)에만 들어간다”가 시스템적으로 보장돼.

---

## 4) 무료 Quick 하루 1팩 레이트리밋 (API 레벨)

### 4-1) DB로 “하루 1개” 체크 (정확하고 간단)

`POST /api/jobs`에서 mode=quick일 때:

* 오늘 생성한 quick job이 있으면 429 반환

`app/api/jobs/route.ts`에 추가:

```ts
// mode === "quick"일 때, 하루 1팩 제한
if (mode === "quick") {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0,0,0,0);
  const end = new Date(now);
  end.setHours(23,59,59,999);

  const count = await prisma.job.count({
    where: {
      userId,
      mode: "quick",
      createdAt: { gte: start, lte: end }
    }
  });

  if (count >= 1) {
    return NextResponse.json({ error: "Daily free limit reached (1 Quick Pack/day)" }, { status: 429 });
  }
}
```

### 4-2) (옵션) IP 기반 레이트리밋 추가

남용 방지로 `ip_hash`도 걸고 싶으면,

* `Job`에 `ipHash` 필드 추가해서 같이 count
* 혹은 Upstash Rate Limit 같은 걸 붙이면 됨(나중에)

