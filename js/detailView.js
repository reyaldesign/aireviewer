/**
 * detailView.js
 * -------------
 * Shared renderer for a completed review's detail-panel content. Used by
 * the live review queue (app.js) and the saved review history page
 * (history.js) so both stay visually consistent and don't duplicate this
 * markup-building logic.
 */

const DetailView = (() => {
  const STATUS_LABELS = {
    approved: 'Approved',
    rejected: 'Rejected',
    needs_review: 'Needs Review',
  };

  /**
   * @param {HTMLElement} container - emptied and filled with the detail markup
   * @param {Object} data
   * @param {string} data.imageUrl
   * @param {string} data.filename
   * @param {number} data.score
   * @param {string} data.verdict - 'approved' | 'rejected' | 'needs_review'
   * @param {string} [data.summary]
   * @param {Array}  [data.checks] - [{criterion, pass, comment, location}]
   * @param {Array}  [data.actionItems]
   * @param {string} [data.metaLine] - optional line under the filename (e.g. client + date)
   * @param {string} [data.footerNote]
   */
  function render(container, data) {
    container.innerHTML = '';

    let image = document.createElement('img');
    image.className = 'detail-img';
    image.src = data.imageUrl;
    container.appendChild(image);

    const name = document.createElement('p');
    name.className = 'detail-name';
    name.textContent = data.filename || '';
    container.appendChild(name);

    if (data.metaLine) {
      const meta = document.createElement('p');
      meta.className = 'hint detail-meta';
      meta.textContent = data.metaLine;
      container.appendChild(meta);
    }

    const score = document.createElement('div');
    score.className = 'detail-score';
    score.textContent = `${data.score}%`;
    container.appendChild(score);

    // Wrap the image so failed-check circle markers can be positioned over it.
    const imageWrap = document.createElement('div');
    imageWrap.className = 'detail-img-wrap';
    image.replaceWith(imageWrap);
    imageWrap.appendChild(image);

    let markerCount = 0;
    (data.checks || []).forEach((c) => {
      if (!c.pass && c.location &&
          typeof c.location.x === 'number' && typeof c.location.y === 'number') {
        const marker = document.createElement('div');
        marker.className = 'issue-marker';
        marker.style.left = `${c.location.x * 100}%`;
        marker.style.top = `${c.location.y * 100}%`;
        marker.title = c.comment || c.criterion;
        imageWrap.appendChild(marker);
        markerCount += 1;
      }
    });

    if (markerCount > 0) {
      const markerNote = document.createElement('p');
      markerNote.className = 'hint marker-note';
      markerNote.textContent = `${markerCount} issue${markerCount > 1 ? 's' : ''} marked on the image above (Claude's estimated location, hover a circle for details).`;
      container.appendChild(markerNote);
    }

    const verdict = document.createElement('div');
    verdict.className = 'detail-verdict';
    verdict.textContent = `Verdict: ${STATUS_LABELS[data.verdict] || data.verdict}`;
    container.appendChild(verdict);

    if (data.summary) {
      const summaryEl = document.createElement('p');
      summaryEl.className = 'detail-summary';
      summaryEl.textContent = data.summary;
      container.appendChild(summaryEl);
    }

    const checksHeading = document.createElement('h3');
    checksHeading.className = 'detail-subheading';
    checksHeading.textContent = 'Criteria breakdown';
    container.appendChild(checksHeading);

    const list = document.createElement('ul');
    list.className = 'check-list';
    (data.checks || []).forEach((c) => {
      const li = document.createElement('li');
      li.className = 'check-item';

      const icon = document.createElement('span');
      icon.className = `check-icon ${c.pass ? 'pass' : 'fail'}`;
      icon.textContent = c.pass ? '✓' : '✕';

      const textWrap = document.createElement('div');
      textWrap.className = 'check-text';
      const strong = document.createElement('strong');
      strong.textContent = c.criterion;
      const comment = document.createElement('div');
      comment.className = 'check-comment';
      comment.textContent = c.comment;
      textWrap.appendChild(strong);
      textWrap.appendChild(comment);

      li.appendChild(icon);
      li.appendChild(textWrap);
      list.appendChild(li);
    });
    container.appendChild(list);

    const actionItems = (data.actionItems && data.actionItems.length)
      ? data.actionItems
      : (data.checks || []).filter(c => !c.pass).map(c => c.comment || c.criterion);

    const actionHeading = document.createElement('h3');
    actionHeading.className = 'detail-subheading';
    actionHeading.textContent = 'What needs to be fixed';
    container.appendChild(actionHeading);

    if (actionItems.length) {
      const actionList = document.createElement('ul');
      actionList.className = 'action-list';
      actionItems.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        actionList.appendChild(li);
      });
      container.appendChild(actionList);
    } else {
      const okNote = document.createElement('p');
      okNote.className = 'hint';
      okNote.textContent = 'No issues found, this image meets all criteria.';
      container.appendChild(okNote);
    }

    if (data.footerNote) {
      const note = document.createElement('div');
      note.className = 'detail-note';
      note.textContent = data.footerNote;
      container.appendChild(note);
    }
  }

  return { render, STATUS_LABELS };
})();
