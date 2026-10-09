/**
 * reviewEngine.js
 * ----------------
 * Calls the local Python backend (server.py), which forwards the image and
 * your criteria list to Claude's vision API and returns a structured
 * grading result. See README.md to set up and run that backend.
 *
 * This function never throws: if the backend is unreachable, misconfigured,
 * or errors out, it resolves a 'needs_review' result with a comment
 * explaining what went wrong, so the rest of the app keeps working.
 *
 * RESULT_SHAPE = {
 *   score: number,           // 0-100 overall
 *   verdict: 'approved' | 'rejected' | 'needs_review',
 *   checks: [
 *     { criterion: string, pass: boolean, comment: string }
 *   ]
 * }
 */

const ReviewEngine = (() => {

  const API_ENDPOINT = 'api/review';

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // reader.result looks like "data:image/png;base64,AAAA..."
        const base64 = String(reader.result).split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(file);
    });
  }

  function errorResult(message) {
    return {
      score: 0,
      verdict: 'needs_review',
      checks: [{ criterion: 'AI review', pass: false, comment: message }],
    };
  }

  /**
   * @param {File} imageFile - the raw File object selected/dropped by the user
   * @param {string[]} criteria
   * @param {string} [originalFilename] - defaults to imageFile.name; kept as a
   *   separate param since saved history stores this as its own field
   * @param {number|null} [clientId] - tags the saved review with this client
   * @param {number|null} [categoryId] - tags the saved review with this client's image category
   * @returns {Promise<{score:number, verdict:string, checks:Array}>}
   */
  async function reviewImage(imageFile, criteria, originalFilename, clientId, categoryId) {
    try {
      const image_base64 = await fileToBase64(imageFile);
      const media_type = imageFile.type || 'image/jpeg';

      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64,
          media_type,
          criteria,
          original_filename: originalFilename || imageFile.name,
          client_id: clientId ?? null,
          category_id: categoryId ?? null,
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        return errorResult(`Backend error (${res.status}): ${detail}`);
      }

      const result = await res.json();
      if (typeof result.score !== 'number' || !Array.isArray(result.checks)) {
        return errorResult('Backend returned an unexpected response shape.');
      }
      return result;
    } catch (err) {
      return errorResult(
        `Could not reach the review backend at ${API_ENDPOINT}. Is server.py running? (${err.message})`
      );
    }
  }

  return { reviewImage };
})();
