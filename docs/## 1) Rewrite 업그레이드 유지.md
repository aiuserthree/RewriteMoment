## 1) Rewrite 업그레이드 유지

### 1-1) 결과 API가 “재사용 가능한 Rewrite 텍스트” 내려주기

`app/api/jobs/[jobId]/route.ts`에서 rewrite를 이렇게 내려줘(민감정보 줄이려고 기본은 sanitized 권장):

```ts
rewrite: job.rewriteInput ? {
  enabled: job.rewriteEnabled,
  distanceMode: job.rewriteInput.distanceMode,
  desiredEnding: job.rewriteInput.desiredEnding,
  reuseText: job.rewriteInput.sanitizedText, // 업그레이드 재사용용
} : { enabled: false },
```

### 1-2) Result 페이지 업그레이드 시 rewriteText 유지

`/app/result/[jobId]/page.tsx`의 `upgradeTo()`에서:

```ts
rewriteEnabled: data.rewrite?.enabled ?? false,
rewriteRawText: data.rewrite?.reuseText ?? "",
distanceMode: data.rewrite?.distanceMode ?? "similar",
desiredEnding: data.rewrite?.desiredEnding ?? "growth",
```

이렇게 하면 Quick에서 만든 Rewrite 설정이 Story/Trailer로 그대로 넘어가.

---

## 2) 공유 링크(share token) + 조회수 카운트

### 2-1) Prisma 모델 추가

`prisma/schema.prisma`:

```prisma
model Share {
  id        String   @id @default(cuid())
  token     String   @unique
  jobId     String
  job       Job      @relation(fields: [jobId], references: [id])
  views     Int      @default(0)
  createdAt DateTime @default(now())
  lastViewedAt DateTime?
}
```

마이그레이션.

### 2-2) 공유 생성 API: `POST /api/shares`

`app/api/shares/route.ts`

```ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

function makeToken() {
  return crypto.randomBytes(16).toString("hex"); // 32 chars
}

export async function POST(req: Request) {
  const { jobId } = await req.json();
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status !== "done") return NextResponse.json({ error: "job not ready" }, { status: 400 });

  // 이미 공유가 있으면 재사용(원하면 새로 발급도 가능)
  const existing = await prisma.share.findFirst({ where: { jobId } });
  if (existing) return NextResponse.json({ token: existing.token });

  const token = makeToken();
  await prisma.share.create({ data: { token, jobId } });
  return NextResponse.json({ token });
}
```

### 2-3) 공유 조회(조회수 증가): `GET /api/shares/[token]`

`app/api/shares/[token]/route.ts`

```ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { mapJobAssets } from "@/lib/result/mapper";

const prisma = new PrismaClient();

export async function GET(_: Request, { params }: { params: { token: string } }) {
  const share = await prisma.share.findUnique({
    where: { token: params.token },
    include: { job: { include: { assets: true, photos: true, rewriteInput: true } } }
  });
  if (!share) return NextResponse.json({ error: "not found" }, { status: 404 });

  // views +1
  await prisma.share.update({
    where: { token: params.token },
    data: { views: { increment: 1 }, lastViewedAt: new Date() }
  });

  const job = share.job;
  return NextResponse.json({
    token: share.token,
    views: share.views + 1,
    job: {
      id: job.id,
      mode: job.mode,
      stage: job.stage,
      genre: job.genre,
      result: mapJobAssets(job)
    }
  });
}
```

### 2-4) 공유 페이지: `/s/[token]`

`app/s/[token]/page.tsx`

```tsx
"use client";
import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import { useParams } from "next/navigation";

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string|null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await getJSON(`/api/shares/${token}`);
        setData(d);
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, [token]);

  if (err) return <div style={{ padding: 16, color: "crimson" }}>{err}</div>;
  if (!data) return <div style={{ padding: 16 }}>불러오는 중…</div>;

  const r = data.job.result;
  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>공유된 결과</h1>
      <div style={{ opacity: 0.8, marginTop: 6 }}>views: {data.views}</div>

      {r.mode === "trailer" ? (
        <video src={r.trailerUrl} controls style={{ width: "100%", borderRadius: 12, marginTop: 16 }} />
      ) : (
        <div style={{ marginTop: 16 }}>
          {r.clips.map((c: any) => (
            <div key={c.clipNo} style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600 }}>Clip {c.clipNo}</div>
              <video src={c.videoUrl} controls style={{ width: "100%", borderRadius: 12 }} />
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.75 }}>
        Fiction / Simulation (가상의 창작물)
      </div>
    </div>
  );
}
```

### 2-5) Result 화면에 “공유 링크 만들기” 버튼

`/app/result/[jobId]/page.tsx`에 추가:

```tsx
async function createShare() {
  const res = await postJSON<{ token: string }>("/api/shares", { jobId });
  const url = `${window.location.origin}/s/${res.token}`;
  await navigator.clipboard.writeText(url);
  alert("공유 링크가 복사됐어!");
}
```

버튼:

```tsx
<button onClick={createShare} style={{ padding:"10px 12px", borderRadius:10 }}>
  공유 링크 만들기
</button>
```

---

## 3) 워터마크/자막 합성 파이프라인(스텁 → 나중에 ffmpeg)

### 3-1) postprocess 모듈 스텁

`lib/postprocess/watermark.ts`

```ts
export async function applyWatermark(params: {
  inputUrl: string;
  outputKey: string;
  watermarkText: string;
}): Promise<{ url: string }> {
  // TODO: ffmpeg overlay로 교체
  // MVP: 그대로 반환 + 메타에서 watermarked 표시
  return { url: params.inputUrl };
}

export async function applyCaptions(params: {
  inputUrl: string;
  outputKey: string;
  captions: Array<{ t: number; text: string }>;
}): Promise<{ url: string }> {
  // TODO: ffmpeg drawtext/subtitles로 교체
  return { url: params.inputUrl };
}
```

### 3-2) Worker에서 video 결과에 후처리 적용

worker에서 `results` 저장 직전에:

```ts
import { applyWatermark } from "@/lib/postprocess/watermark";

const watermarked = [];
for (const r of results) {
  if (r.kind !== "video") { watermarked.push(r); continue; }

  const out = await applyWatermark({
    inputUrl: r.url,
    outputKey: `wm_${job.id}_${r.key}`,
    watermarkText: "Fiction / Simulation"
  });

  watermarked.push({ ...r, url: out.url, meta: { ...(r.meta ?? {}), watermarked: true } });
}

// 이후 watermarked를 Asset으로 저장
```

> 나중에 ffmpeg 붙일 때도 worker 코드는 그대로 두고 `applyWatermark()`만 교체하면 됨.

---

## 4) 무료 남용 방지(IP hash + deviceId)

### 4-1) Client deviceId 발급(로컬스토리지)

`lib/client/deviceId.ts`

```ts
export function getDeviceId(): string {
  const key = "device_id_v1";
  let v = localStorage.getItem(key);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(key, v);
  }
  return v;
}
```

### 4-2) Draft/Confirm 요청에 deviceId 포함

* `/app/upload/page.tsx`에서 draft 만들 때 `deviceId` 포함
* `/app/select/page.tsx` confirm에도 포함

예:

```ts
import { getDeviceId } from "@/lib/client/deviceId";
const deviceId = getDeviceId();
```

### 4-3) 서버에서 IP hash 계산

`lib/safety/ipHash.ts`

```ts
import crypto from "crypto";

export function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}
```

### 4-4) Prisma에 Job에 ipHash/deviceId 저장(최소)

`prisma/schema.prisma` Job에 필드 추가:

```prisma
model Job {
  // ...
  ipHash   String?
  deviceId String?
}
```

### 4-5) draft/confirm API에서 저장 + 무료 제한을 “유저/디바이스/IP”로

`/api/jobs/draft`에서:

```ts
import { getClientIp, hashIp } from "@/lib/safety/ipHash";
// ...
const deviceId = body.deviceId as string | undefined;
const ip = getClientIp(req);
const ipHash = hashIp(ip);

const job = await prisma.job.create({
  data: {
    userId,
    // ...
    status: "draft",
    deviceId: deviceId ?? null,
    ipHash
  }
});
```

`/api/jobs/confirm`에서 Quick 하루 1팩 제한을 이렇게 강화:

```ts
// userId OR deviceId OR ipHash로 하루 1팩 제한
const deviceId = body.deviceId as string | undefined;
const ipHash = hashIp(getClientIp(req));

const whereAny: any[] = [{ userId }];
if (deviceId) whereAny.push({ deviceId });
if (ipHash) whereAny.push({ ipHash });

const count = await prisma.job.count({
  where: {
    mode: "quick",
    status: { not: "draft" },
    createdAt: { gte: start, lte: end },
    OR: whereAny
  }
});
if (count >= 1) return NextResponse.json({ error: "Daily free limit reached" }, { status: 429 });

// confirm 시 job에도 갱신
await prisma.job.update({
  where: { id: draftJobId },
  data: { deviceId: deviceId ?? null, ipHash }
});
```


