const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

function authOk(request, env) {
  const expected = env.WORKER_API_KEY;
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  const key = request.headers.get("x-api-key") || "";
  return auth === `Bearer ${expected}` || key === expected;
}

function isValidJobId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value);
}

function isValidUserId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 120;
}

function isAllowedSourceUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return false;
    const allowed = new Set([
      "github.com",
      "raw.githubusercontent.com",
      "objects.githubusercontent.com",
      "codeload.github.com",
      "release-assets.githubusercontent.com",
    ]);
    return allowed.has(u.hostname);
  } catch {
    return false;
  }
}

async function github(env, path, init = {}) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "flutter-build-worker",
      ...(init.headers || {}),
    },
  });
}

async function getRun(env, runId) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const res = await github(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}`);
  if (!res.ok) return { response: res, data: null };
  return { response: res, data: await res.json() };
}

async function getFirstArtifact(env, runId) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const res = await github(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100`);
  if (!res.ok) return { response: res, data: null };
  const data = await res.json();
  const artifact = (data.artifacts || []).find((a) => a.name.startsWith("apk-") && !a.expired);
  return { response: res, data: artifact || null };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, content-type, x-api-key",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        },
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "flutter-build-worker", time: new Date().toISOString() });
    }

    if (!authOk(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    if (url.pathname === "/build" && request.method === "POST") {
      try {
        const body = await request.json();
        const { jobId, userId, url: sourceUrl, buildType = "release" } = body || {};

        if (!isValidJobId(jobId)) return json({ ok: false, error: "jobId must use A-Z, a-z, 0-9, dot, underscore or hyphen (max 80)" }, 400);
        if (!isValidUserId(userId)) return json({ ok: false, error: "userId is required (max 120 chars)" }, 400);
        if (!isAllowedSourceUrl(sourceUrl)) return json({ ok: false, error: "url must be an HTTPS GitHub download URL" }, 400);
        if (!["debug", "profile", "release"].includes(buildType)) return json({ ok: false, error: "buildType must be debug, profile, or release" }, 400);

        const owner = env.GITHUB_OWNER;
        const repo = env.GITHUB_REPO;
        const workflow = env.GITHUB_WORKFLOW || "build-flutter.yml";
        const ref = env.GITHUB_REF || "main";
        const payload = JSON.stringify({ url: sourceUrl, buildType });

        const dispatch = await github(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ref, inputs: { jobId, userId, payload } }),
        });

        const text = await dispatch.text();
        if (!dispatch.ok) {
          return json({ ok: false, error: "GitHub workflow dispatch failed", githubStatus: dispatch.status, details: text.slice(0, 2000) }, 502);
        }

        let dispatchData = {};
        try { dispatchData = text ? JSON.parse(text) : {}; } catch {}

        let runId = dispatchData.workflow_run_id || null;
        let runUrl = dispatchData.run_url || null;

        // Older GitHub API responses may be 204 without run metadata. Find the run by run-name.
        if (!runId) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const runsRes = await github(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=20`);
          if (runsRes.ok) {
            const runs = await runsRes.json();
            const candidates = (runs.workflow_runs || []).filter((r) =>
              typeof r.name === "string" && r.name.includes(jobId)
            );
            if (candidates.length) {
              candidates.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
              runId = candidates[0].id;
              runUrl = candidates[0].html_url;
            }
          }
        }

        return json({ ok: true, jobId, runId, runUrl, artifactName: `apk-${jobId}`, message: "Build queued" }, 202);
      } catch (error) {
        return json({ ok: false, error: error?.message || "Internal error" }, 500);
      }
    }

    const statusMatch = url.pathname.match(/^\/status\/(\d+)$/);
    if (statusMatch && request.method === "GET") {
      try {
        const runId = statusMatch[1];
        const { response, data } = await getRun(env, runId);
        if (!response.ok) return json({ ok: false, error: "GitHub run not found", githubStatus: response.status }, response.status === 404 ? 404 : 502);
        return json({
          ok: true,
          runId: data.id,
          status: data.status,
          conclusion: data.conclusion,
          name: data.name,
          htmlUrl: data.html_url,
          createdAt: data.created_at,
          startedAt: data.run_started_at,
          updatedAt: data.updated_at,
        });
      } catch (error) {
        return json({ ok: false, error: error?.message || "Internal error" }, 500);
      }
    }

    const artifactMatch = url.pathname.match(/^\/artifact\/(\d+)$/);
    if (artifactMatch && request.method === "GET") {
      try {
        const runId = artifactMatch[1];
        const { response: runResponse, data: run } = await getRun(env, runId);
        if (!runResponse.ok) return json({ ok: false, error: "GitHub run not found" }, 404);
        if (run.status !== "completed") return json({ ok: false, error: "Build is not completed", status: run.status }, 409);
        if (run.conclusion !== "success") return json({ ok: false, error: "Build failed", conclusion: run.conclusion, runUrl: run.html_url }, 409);

        const { response: artifactResponse, data: artifact } = await getFirstArtifact(env, runId);
        if (!artifactResponse.ok) return json({ ok: false, error: "Could not read artifacts", githubStatus: artifactResponse.status }, 502);
        if (!artifact) return json({ ok: false, error: "APK artifact not found or expired" }, 404);

        const download = await fetch(artifact.archive_download_url, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "flutter-build-worker",
          },
          redirect: "follow",
        });
        if (!download.ok) return json({ ok: false, error: "Artifact download failed", status: download.status }, 502);

        return new Response(download.body, {
          status: 200,
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="apk-${runId}.zip"`,
            "cache-control": "no-store",
          },
        });
      } catch (error) {
        return json({ ok: false, error: error?.message || "Internal error" }, 500);
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};
