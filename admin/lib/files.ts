/** Reads a file as base64 without the data-URL prefix, for JSON upload bodies. */
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/** Largest upload the API accepts (it re-encodes and shrinks images on arrival). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
