import { useEffect, useState } from "react";
import { api, json } from "./api";
export function FileUpload({
  file,
  submit,
  cancel,
  busy,
}: {
  file: File;
  submit: (form: FormData) => Promise<void>;
  cancel: () => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState("local");
  const [config, setConfig] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    api("/parsing")
      .then((c) => {
        if (active) {
          setConfig(c);
          setMode(c.defaultMode);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function review() {
    setLoading(true);
    setError("");
    try {
      if (file.size > config.maxBytes) throw new Error("文件超过云解析上限");
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
        (x) => x.toString(16).padStart(2, "0"),
      ).join("");
      setPreview(
        await api("/parsing/preview", {
          method: "POST",
          body: json({
            mode: "glm",
            filename: file.name,
            size: file.size,
            sha256: hash,
          }),
        }),
      );
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法生成上传确认");
    } finally {
      setLoading(false);
    }
  }
  async function upload() {
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);
    if (mode === "glm") {
      form.set("previewId", preview.previewId);
      form.set("consent", "true");
    }
    try {
      await submit(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
      setPreview(null);
      setConsent(false);
    }
  }
  return (
    <div className="view-card file-upload-review">
      <h3>选择文件解析方式</h3>
      <p>
        {file.name} · {(file.size / 1024).toFixed(1)} KiB
      </p>
      <label>
        解析模式{" "}
        <select
          aria-label="文件解析模式"
          value={mode}
          disabled={busy || loading || !config}
          onChange={(e) => {
            setMode(e.target.value);
            setPreview(null);
            setConsent(false);
          }}
        >
          <option value="local">本地解析（不出网，需本地工具）</option>
          <option value="glm">GLM 完整文件解析</option>
        </select>
      </label>
      {mode === "local" ? (
        <p>
          PDF / 图片 / DOC 需要 Poppler / Tesseract /
          antiword。缺少工具会提示，不会自动上传云端。
        </p>
      ) : (
        <>
          <p>
            GLM-5.3-Flash 负责文件转写，与 glm-5.3 医疗解读独立。DOC/DOCX
            兼容性尚未实测。图片上限 4 MiB、6000×6000；文件上限 20 MiB。
          </p>
          <button
            className="button"
            disabled={busy || loading || !config}
            onClick={review}
          >
            核对接收方与完整文件上传
          </button>
        </>
      )}
      {preview && (
        <div
          className="alert warning"
          style={{ display: "block", overflowWrap: "anywhere" }}
        >
          <p>{preview.warning}</p>
          <p>
            接收方：{preview.recipient}（默认智谱 GLM；自定义端点请核对运营方）
          </p>
          <p>端点：{preview.endpoint}</p>
          <p>
            模型：{preview.model} ·{" "}
            {preview.provider === "mock"
              ? "MOCK 固定虚构结果，不出网、不识别实际文件"
              : "实时完整文件发送"}
          </p>
          <p>
            文件：{preview.filename} · {preview.size} 字节
          </p>
          <p>SHA-256：{preview.sha256}</p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            我已核对接收方，同意本次向该端点发送此完整文件，理解其中身份信息不会脱敏
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="button-group">
        <button className="button" disabled={busy || loading} onClick={cancel}>
          取消
        </button>
        <button
          className="button primary"
          disabled={
            !config ||
            busy ||
            loading ||
            (mode === "glm" && (!preview || !consent))
          }
          onClick={upload}
        >
          {busy ? "上传中…" : "上传并解析"}
        </button>
      </div>
    </div>
  );
}
