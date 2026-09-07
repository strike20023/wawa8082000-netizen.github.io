function apiUrl(baseUrl, pathOrUrl) {
  return new URL(pathOrUrl, `${baseUrl}/`).toString();
}

export class NocoDbClient {
  constructor({ baseUrl, apiToken, baseId, tableId, fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl;
    this.apiToken = apiToken;
    this.baseId = baseId;
    this.tableId = tableId;
    this.fetchImpl = fetchImpl;
  }

  headers(extra = {}) {
    return { "xc-token": this.apiToken, ...extra };
  }

  async requestJson(pathOrUrl, options = {}) {
    const response = await this.fetchImpl(apiUrl(this.baseUrl, pathOrUrl), {
      ...options,
      headers: this.headers(options.headers)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`NocoDB API ${response.status}: ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async listRecords() {
    const records = [];
    let next = `/api/v3/data/${encodeURIComponent(this.baseId)}/${encodeURIComponent(this.tableId)}/records?pageSize=100`;
    let pageCount = 0;

    while (next) {
      if (++pageCount > 1000) throw new Error("NocoDB 分页超过安全上限");
      const data = await this.requestJson(next);
      if (!Array.isArray(data?.records)) throw new Error("NocoDB 返回内容缺少 records 数组");
      records.push(...data.records);
      next = data.next || null;
    }
    return records;
  }

  async patchRecords(patches) {
    for (let index = 0; index < patches.length; index += 10) {
      const batch = patches.slice(index, index + 10);
      await this.requestJson(
        `/api/v3/data/${encodeURIComponent(this.baseId)}/${encodeURIComponent(this.tableId)}/records`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch)
        }
      );
    }
  }

  async downloadAttachment(attachment, maxFileBytes) {
    if (attachment.size && attachment.size > maxFileBytes) {
      throw new Error(`${attachment.name} 为 ${formatBytes(attachment.size)}，超过 ${formatBytes(maxFileBytes)}`);
    }

    const resolvedUrl = apiUrl(this.baseUrl, attachment.url);
    const sameOrigin = new URL(resolvedUrl).origin === new URL(this.baseUrl).origin;
    const response = await this.fetchImpl(resolvedUrl, {
      headers: sameOrigin ? this.headers() : {}
    });
    if (!response.ok) {
      throw new Error(`附件下载失败 ${response.status}: ${attachment.name}`);
    }
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > maxFileBytes) {
      throw new Error(`${attachment.name} 为 ${formatBytes(declaredSize)}，超过 ${formatBytes(maxFileBytes)}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxFileBytes) {
      throw new Error(`${attachment.name} 为 ${formatBytes(bytes.byteLength)}，超过 ${formatBytes(maxFileBytes)}`);
    }
    return {
      bytes,
      mime: attachment.mime || response.headers.get("content-type")?.split(";", 1)[0] || "application/octet-stream"
    };
  }
}

export function normalizeAttachments(value) {
  if (!value) return [];
  let items = value;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(items)) items = [items];

  return items.map((item, index) => {
    if (typeof item === "string") {
      return { name: `附件-${index + 1}`, url: item, mime: "", size: 0 };
    }
    const url = item.signedUrl || item.signedPath || item.url || item.path;
    if (!url) throw new Error(`第 ${index + 1} 个附件缺少下载地址`);
    return {
      name: String(item.title || item.name || item.filename || `附件-${index + 1}`),
      url: String(url),
      mime: String(item.mimetype || item.mimeType || item.type || ""),
      size: Number(item.size || item.bytes || 0)
    };
  });
}

export function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
