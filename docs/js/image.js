// Compressão de foto no aparelho (nada é enviado a lugar nenhum).
const MAX_INPUT = 40 * 1024 * 1024;

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir a imagem.')); };
    img.src = url;
  });
}

/** Reduz o maior lado para `maxEdge` px e grava como JPEG. Retorna { bytes: ArrayBuffer, type, width, height }. */
export async function compressImage(file, { maxEdge = 1600, quality = 0.8 } = {}) {
  if (!file) throw new Error('Nenhuma imagem.');
  if (file.size > MAX_INPUT) throw new Error('Imagem grande demais (máx. 40 MB).');
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { src = await loadViaImg(file); }
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error('Imagem inválida.');
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const width = Math.max(1, Math.round(w0 * scale));
  const height = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); // PNG com transparência vira fundo branco
  ctx.drawImage(src, 0, 0, width, height);
  if (src.close) src.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Não foi possível comprimir a imagem.');
  return { bytes: await blob.arrayBuffer(), type: 'image/jpeg', width, height };
}
