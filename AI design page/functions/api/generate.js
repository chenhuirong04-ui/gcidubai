// /api/generate.js  (Vercel Serverless Function)
// POST /api/generate  => JSON

export default async function handler(req, res) {
  // CORS（可选，但建议保留）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, step: "method", error: "Use POST" });
  }

  try {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return res.status(500).json({ ok: false, step: "env", error: "Missing REPLICATE_API_TOKEN" });
    }

    const { imageBase64, style } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ ok: false, step: "input", error: "Missing imageBase64" });
    }

    // 你可以把这里换成你实际在用的 Replicate 模型 version
    // 如果你不确定，就先用你之前成功过的那个 version 字符串
    const VERSION = "YOUR_REPLICATE_MODEL_VERSION_HERE";

    // 根据风格给提示词（尽量简单、稳定）
    const preset = presetPrompt(style);

    // Replicate create prediction
    const createResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: VERSION,
        input: {
          image: imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`,
          prompt: preset.prompt,
          negative_prompt: preset.negative,
        }
      }),
    });

    const createText = await createResp.text();
    let createJson;
    try { createJson = JSON.parse(createText); } catch {
      return res.status(500).json({ ok: false, step: "replicate_create_parse", error: createText.slice(0, 300) });
    }
    if (!createResp.ok) {
      return res.status(500).json({
        ok: false,
        step: "replicate_create",
        error: createJson?.detail || createJson?.error || `HTTP ${createResp.status}`,
        raw: createJson
      });
    }

    // poll until done
    const id = createJson.id;
    const deadline = Date.now() + 120000; // 120s
    while (Date.now() < deadline) {
      await sleep(2000);

      const pollResp = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { "Authorization": `Token ${token}` },
      });
      const pollText = await pollResp.text();
      let pollJson;
      try { pollJson = JSON.parse(pollText); } catch {
        return res.status(500).json({ ok: false, step: "replicate_poll_parse", error: pollText.slice(0, 300) });
      }
      if (!pollResp.ok) {
        return res.status(500).json({
          ok: false,
          step: "replicate_poll",
          error: pollJson?.detail || pollJson?.error || `HTTP ${pollResp.status}`,
          raw: pollJson
        });
      }

      if (pollJson.status === "succeeded") {
        // output 可能是 string / array / object，统一处理成 urls[]
        const urls = normalizeOutputToUrls(pollJson.output);
        return res.status(200).json({
          ok: true,
          style,
          id,
          urls,
          raw: pollJson
        });
      }

      if (pollJson.status === "failed" || pollJson.status === "canceled") {
        return res.status(500).json({
          ok: false,
          step: "replicate_failed",
          error: pollJson?.error || pollJson.status,
          raw: pollJson
        });
      }
    }

    return res.status(504).json({ ok: false, step: "timeout", error: "Replicate timeout" });
  } catch (e) {
    return res.status(500).json({ ok: false, step: "server", error: String(e?.message || e) });
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function presetPrompt(style) {
  const negative = "low quality, blurry, distorted, warped, messy, clutter, text, watermark, logo";
  const s = (style || "").toLowerCase();

  if (s.includes("luxury")) {
    return { prompt: "luxury interior redesign, elegant neutral palette, premium materials, warm lighting, photorealistic", negative };
  }
  if (s.includes("scandinav")) {
    return { prompt: "scandinavian interior redesign, bright airy, light wood, clean lines, cozy minimal, photorealistic", negative };
  }
  if (s.includes("arab")) {
    return { prompt: "arabic luxury interior redesign, modern arabic patterns, warm ambient lighting, premium textures, photorealistic", negative };
  }
  // default minimal/modern
  return { prompt: "modern minimal interior redesign, clean lines, calm neutral palette, realistic lighting, photorealistic", negative };
}

function normalizeOutputToUrls(output) {
  if (!output) return [];
  if (typeof output === "string") return [output];
  if (Array.isArray(output)) return output.filter(Boolean);
  if (typeof output === "object") {
    // 有些模型 output 里会有 {images:[...]} 或 {image: "..."}
    if (Array.isArray(output.images)) return output.images.filter(Boolean);
    if (typeof output.image === "string") return [output.image];
  }
  return [];
}
