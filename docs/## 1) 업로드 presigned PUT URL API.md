## 1) 업로드: presigned PUT URL API

### 1-1) `lib/upload/s3.ts`

```ts
// lib/upload/s3.ts
import { S3Client } from "@aws-sdk/client-s3";

export function getS3Client() {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT, // R2면 https://<accountid>.r2.cloudflarestorage.com
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true", // MinIO 쓸 때 true
  });
}

export const UPLOAD_BUCKET = process.env.S3_BUCKET!;
export const PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL!; 
// 예: https://cdn.yourdomain.com (또는 R2 public URL, CloudFront 등)
```

### 1-2) `app/api/upload/presign/route.ts`

```ts
// app/api/upload/presign/route.ts
import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import { getS3Client, UPLOAD_BUCKET, PUBLIC_BASE_URL } from "@/lib/upload/s3";

function safeExt(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  throw new Error("Unsupported mime");
}

export async function POST(req: Request) {
  const body = await req.json();
  const userId = body.userId as string;      // MVP: body로 받음 (나중에 auth에서 꺼내기)
  const mime = body.mime as string;          // image/jpeg|png|webp
  const size = Number(body.size ?? 0);

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (!mime) return NextResponse.json({ error: "mime required" }, { status: 400 });
  if (size <= 0 || size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "size invalid (<=10MB)" }, { status: 400 });
  }

  let ext: string;
  try { ext = safeExt(mime); } 
  catch { return NextResponse.json({ error: "unsupported mime" }, { status: 400 }); }

  const key = `uploads/${userId}/${Date.now()}_${crypto.randomBytes(8).toString("hex")}.${ext}`;

  const s3 = getS3Client();
  const cmd = new PutObjectCommand({
    Bucket: UPLOAD_BUCKET,
    Key: key,
    ContentType: mime,
    // ACL은 R2에서 무의미/제한될 수 있음. Public은 PUBLIC_BASE_URL로 해결.
  });

  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 }); // 60초 유효
  const publicUrl = `${PUBLIC_BASE_URL}/${key}`;

  return NextResponse.json({ key, uploadUrl, publicUrl });
}
```

---

## 2) Job에 “입력 사진” 연결 (DB 모델 + API)

### 2-1) Prisma 모델 추가: `JobPhoto`

`prisma/schema.prisma`에 추가:

```prisma
model JobPhoto {
  id        String   @id @default(cuid())
  jobId     String
  job       Job      @relation(fields: [jobId], references: [id])
  url       String
  createdAt DateTime @default(now())

  @@index([jobId])
}
```

그리고 `Job`에 관계 추가:

```prisma
model Job {
  // ...기존 필드
  photos JobPhoto[]
}
```

마이그레이션 후.

---

## 3) “Job 생성” 흐름을 2단계로 바꾸기 (추천)

* 1. 사진 업로드 → 서버에 **Draft Job(초안)** 만들고 photos 저장
* 2. 선택(모드/스테이지/장르/Rewrite) 완료 → draft를 **queued job**으로 확정하고 큐에 넣기

이렇게 하면 UI가 훨씬 단순해져.

### 3-1) Draft 생성 API: `POST /api/jobs/draft`

`app/api/jobs/draft/route.ts`

```ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  const body = await req.json();
  const userId = body.userId as string;
  const photoUrls = (body.photoUrls ?? []) as string[];

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (photoUrls.length < 1 || photoUrls.length > 3) {
    return NextResponse.json({ error: "photoUrls must be 1~3" }, { status: 400 });
  }

  const job = await prisma.job.create({
    data: {
      userId,
      mode: "quick",     // 임시값 (확정 때 바뀜)
      stage: "teen",
      genre: "comedy",
      slidersJson: { realism: 0.6, intensity: 0.4, pace: 0.7 },
      rewriteEnabled: false,
      status: "draft"
    }
  });

  for (const url of photoUrls) {
    await prisma.jobPhoto.create({ data: { jobId: job.id, url } });
  }

  return NextResponse.json({ draftJobId: job.id });
}
```

### 3-2) Draft 확정 API: `POST /api/jobs/confirm`

`app/api/jobs/confirm/route.ts`

```ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { sanitizeRewriteInput } from "@/lib/safety/sanitize";
import { chargeForCreate, getCreditBalance } from "@/lib/credits/ledger";
import { jobQueue } from "@/lib/queue/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  const body = await req.json();

  const userId = body.userId as string;
  const draftJobId = body.draftJobId as string;

  const mode = body.mode as "quick"|"story"|"trailer";
  const stage = body.stage as string;
  const genre = body.genre as string;
  const slidersJson = body.slidersJson ?? { realism: 0.6, intensity: 0.4, pace: 0.7 };

  const rewriteEnabled = Boolean(body.rewriteEnabled);
  const rewriteRawText = (body.rewriteRawText ?? "") as string;
  const distanceMode = (body.distanceMode ?? "similar") as string;
  const desiredEnding = (body.desiredEnding ?? "growth") as string;

  const draft = await prisma.job.findUnique({
    where: { id: draftJobId },
    include: { photos: true }
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (draft.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (draft.status !== "draft") return NextResponse.json({ error: "Not a draft" }, { status: 400 });
  if (!draft.photos?.length) return NextResponse.json({ error: "No photos in draft" }, { status: 400 });

  // 무료 Quick 하루 1팩 제한
  if (mode === "quick") {
    const now = new Date();
    const start = new Date(now); start.setHours(0,0,0,0);
    const end = new Date(now); end.setHours(23,59,59,999);

    const count = await prisma.job.count({
      where: { userId, mode: "quick", status: { not: "draft" }, createdAt: { gte: start, lte: end } }
    });
    if (count >= 1) return NextResponse.json({ error: "Daily free limit reached (1 Quick/day)" }, { status: 429 });
  }

  // 유료 크레딧 체크/차감
  if (mode !== "quick") {
    const balance = await getCreditBalance(userId);
    const needed = (mode === "story" ? 2 : 5) + (rewriteEnabled ? 1 : 0);
    if (balance < needed) return NextResponse.json({ error: "Not enough credits", needed, balance }, { status: 402 });
  }

  // draft 확정 업데이트
  const job = await prisma.job.update({
    where: { id: draftJobId },
    data: {
      mode, stage, genre, slidersJson,
      rewriteEnabled,
      status: "queued"
    }
  });

  // rewrite 저장(선택)
  if (rewriteEnabled && rewriteRawText.trim()) {
    const sanitized = sanitizeRewriteInput(rewriteRawText);
    await prisma.rewriteInput.upsert({
      where: { jobId: job.id },
      update: { rawText: rewriteRawText, sanitizedText: sanitized.sanitizedText, distanceMode, desiredEnding },
      create: { jobId: job.id, rawText: rewriteRawText, sanitizedText: sanitized.sanitizedText, distanceMode, desiredEnding }
    });
  }

  // 크레딧 차감(확정 후)
  if (mode !== "quick") {
    await chargeForCreate({ userId, jobId: job.id, mode, rewriteEnabled });
  }

  // 큐 넣기
  await jobQueue.add("generate", { jobId: job.id }, { removeOnComplete: 1000, removeOnFail: 1000 });

  return NextResponse.json({ jobId: job.id, status: "queued" });
}
```

---

## 4) Worker에서 “실제 업로드 사진 URL”을 IdentityPack에 사용

`lib/queue/worker.ts`에서 userPhotoUrls를 JobPhoto에서 가져오게 바꿔:

```ts
const job = await prisma.job.findUnique({
  where: { id: jobId },
  include: { rewriteInput: true, photos: true }
});
if (!job) throw new Error("Job not found");

const userPhotoUrls = job.photos.map(p => p.url);
const idPack = await ensureIdentityPack({ jobId: job.id, stage: job.stage, userPhotoUrls });
const identityRefs = (idPack.refJson as any).refs.map((r: any) => r.url);
```

---

## 5) 결과 응답 매핑: “화면에서 바로 쓰기 좋은 형태”로 반환

### 5-1) helper: `lib/result/mapper.ts`

```ts
// lib/result/mapper.ts
export function mapJobAssets(job: any) {
  const assets = job.assets ?? [];
  const videos = assets.filter((a: any) => a.type === "video");
  const thumbs = assets.filter((a: any) => a.type === "thumb");

  const byKey = new Map<string, any>();
  for (const a of assets) {
    const key = a.metadataJson?.key;
    if (key) byKey.set(key, a);
  }

  if (job.mode === "trailer") {
    const final = byKey.get("video_final") ?? videos[0] ?? null;
    return {
      mode: "trailer",
      trailerUrl: final?.url ?? null,
      status: job.status
    };
  }

  // quick/story: clip_1~3 우선
  const clips = [1,2,3].map((n) => {
    const v = byKey.get(`clip_${n}`) ?? null;
    const t = byKey.get(`thumb_${n}`) ?? null;
    return { clipNo: n, videoUrl: v?.url ?? null, thumbUrl: t?.url ?? null };
  });

  return { mode: job.mode, clips, status: job.status };
}
```

### 5-2) 결과 조회 API에 적용

`app/api/jobs/[jobId]/route.ts`를 아래처럼 개선:

```ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { mapJobAssets } from "@/lib/result/mapper";

const prisma = new PrismaClient();

export async function GET(_: Request, { params }: { params: { jobId: string } }) {
  const job = await prisma.job.findUnique({
    where: { id: params.jobId },
    include: { assets: true, rewriteInput: true, photos: true }
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: job.id,
    mode: job.mode,
    stage: job.stage,
    genre: job.genre,
    status: job.status,
    photos: job.photos.map(p => p.url),
    rewrite: job.rewriteInput ? {
      enabled: job.rewriteEnabled,
      distanceMode: job.rewriteInput.distanceMode,
      desiredEnding: job.rewriteInput.desiredEnding
    } : { enabled: false },
    result: mapJobAssets(job)
  });
}
```

---

## 6) 프론트에서 쓰는 최소 호출 순서(핵심만)

1. `POST /api/upload/presign` (mime,size,userId) → `uploadUrl, publicUrl`
2. 브라우저에서 `PUT uploadUrl`로 파일 업로드
3. `POST /api/jobs/draft` (userId, photoUrls=[publicUrl들]) → `draftJobId`
4. `POST /api/jobs/confirm` (draftJobId + mode/stage/genre + rewrite...) → `jobId`
5. 결과 폴링: `GET /api/jobs/:jobId` → `result.clips` 또는 `result.trailerUrl`

---

## 7) 환경변수 정리

`.env`

```
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379

S3_ENDPOINT=https://<your-endpoint>
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=...
S3_PUBLIC_BASE_URL=https://<public-base>/<optional>

GENERATION_PROVIDER=stub
```


