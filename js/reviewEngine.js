/**
 * reviewEngine.js: sends one image + its criteria to the backend (POST api/review).
 * Never throws. If the backend fails, it resolves { error: true, ... } with a message.
 *
 * Result: { score, verdict ('approved'|'needs_review'|'rejected'), summary, action_items,
 *           checks: [{ criterion, status: 'pass'|'warn'|'fail', comment, location? }],
 *           review_id?, error? }
 */
const ReviewEngine = (() => {
  const API_ENDPOINT = 'api/review';

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(file);
    });
  }

  function errorResult(message) {
    return {
      score: 0, verdict: 'needs_review', error: true, summary: message, action_items: [],
      checks: [{ criterion: 'AI review', status: 'fail', comment: message }],
    };
  }

  async function reviewImage(imageFile, criteria, originalFilename, clientId, categoryId) {
    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: await fileToBase64(imageFile),
          media_type: imageFile.type || 'image/jpeg',
          criteria,
          original_filename: originalFilename || imageFile.name,
          client_id: clientId ?? null,
          category_id: categoryId ?? null,
        }),
      });
      if (!res.ok) return errorResult(`Backend error (${res.status}): ${await res.text().catch(() => res.statusText)}`);
      const result = await res.json();
      if (typeof result.score !== 'number' || !Array.isArray(result.checks)) return errorResult('Backend returned an unexpected response shape.');
      return result;
    } catch (err) {
      return errorResult(`Could not reach the review backend (${err.message}).`);
    }
  }

  return { reviewImage };
})();
