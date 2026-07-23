/**
 * clients.js
 * ----------
 * UI wiring for the Manage Clients page: create/edit/delete clients, upload
 * a branding logo, and manage each client's saved review criteria. These
 * criteria are what auto-loads on the main Review page when that client is
 * selected there.
 */

(() => {
  const clientListEl = document.getElementById('client-list');
  const newClientForm = document.getElementById('new-client-form');
  const newClientNameInput = document.getElementById('new-client-name');
  const detailEl = document.getElementById('client-detail');

  let clients = [];
  let selectedId = null;

  async function loadClients() {
    try {
      const res = await fetch('/api/clients');
      clients = res.ok ? await res.json() : [];
    } catch (err) {
      clients = [];
    }
    renderList();
  }

  function renderList() {
    clientListEl.innerHTML = '';
    if (!clients.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'No clients yet.';
      clientListEl.appendChild(li);
      return;
    }
    clients.forEach((c) => {
      const li = document.createElement('li');
      li.className = 'client-list-item' + (c.id === selectedId ? ' active' : '');
      li.textContent = c.name;
      li.addEventListener('click', () => selectClient(c.id));
      clientListEl.appendChild(li);
    });
  }

  newClientForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newClientNameInput.value.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        alert(`Could not create client: ${detail}`);
        return;
      }
      const c = await res.json();
      newClientNameInput.value = '';
      await loadClients();
      selectClient(c.id);
    } catch (err) {
      alert(`Could not reach the server: ${err.message}`);
    }
  });

  async function selectClient(id) {
    selectedId = id;
    renderList();
    try {
      const res = await fetch(`/api/clients/${id}`);
      if (!res.ok) return;
      renderDetail(await res.json());
    } catch (err) {
      // Silent — detail panel just won't update.
    }
  }

  function renderDetail(client) {
    detailEl.innerHTML = '';

    // Name + delete
    const headerRow = document.createElement('div');
    headerRow.className = 'client-header-row';

    const nameGroup = document.createElement('div');
    const nameLabel = document.createElement('label');
    nameLabel.className = 'field-label';
    nameLabel.textContent = 'Client name';
    const nameInput = document.createElement('input');
    nameInput.className = 'text-input';
    nameInput.value = client.name;
    nameInput.addEventListener('change', () => {
      saveClientField(client.id, { name: nameInput.value.trim() || client.name });
    });
    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(nameInput);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete client';
    deleteBtn.addEventListener('click', () => deleteClient(client.id));

    headerRow.appendChild(nameGroup);
    headerRow.appendChild(deleteBtn);
    detailEl.appendChild(headerRow);

    // Notes
    const notesGroup = document.createElement('div');
    notesGroup.className = 'field-group';
    const notesLabel = document.createElement('label');
    notesLabel.className = 'field-label';
    notesLabel.textContent = 'Notes';
    const notesInput = document.createElement('textarea');
    notesInput.className = 'text-input';
    notesInput.value = client.notes || '';
    notesInput.addEventListener('change', () => {
      saveClientField(client.id, { notes: notesInput.value });
    });
    notesGroup.appendChild(notesLabel);
    notesGroup.appendChild(notesInput);
    detailEl.appendChild(notesGroup);

    // Branding logo
    const logoGroup = document.createElement('div');
    logoGroup.className = 'field-group';
    const logoLabel = document.createElement('label');
    logoLabel.className = 'field-label';
    logoLabel.textContent = 'Branding logo';
    logoGroup.appendChild(logoLabel);

    const logoBox = document.createElement('div');
    logoBox.className = 'logo-preview-box';
    if (client.logo_path) {
      const img = document.createElement('img');
      img.src = `/uploads/${client.logo_path}`;
      img.alt = `${client.name} logo`;
      logoBox.appendChild(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'logo-placeholder';
      placeholder.textContent = 'No logo uploaded yet.';
      logoBox.appendChild(placeholder);
    }
    logoGroup.appendChild(logoBox);

    const logoInput = document.createElement('input');
    logoInput.type = 'file';
    logoInput.accept = 'image/*';
    logoInput.addEventListener('change', () => {
      if (logoInput.files[0]) uploadLogo(client.id, logoInput.files[0]);
    });
    logoGroup.appendChild(logoInput);
    detailEl.appendChild(logoGroup);

    // Criteria
    const critHeading = document.createElement('h3');
    critHeading.className = 'detail-subheading';
    critHeading.textContent = `Review criteria for ${client.name}`;
    detailEl.appendChild(critHeading);

    const critHint = document.createElement('p');
    critHint.className = 'hint';
    critHint.textContent = 'These load automatically when this client is selected on the Review page. Existing saved reviews keep the criteria that were active at the time, so editing here doesn\'t rewrite history.';
    detailEl.appendChild(critHint);

    const critList = document.createElement('ul');
    critList.className = 'criteria-list';
    (client.criteria || []).forEach((crit) => {
      const li = document.createElement('li');
      li.className = 'criteria-item';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = crit.text;
      input.addEventListener('change', () => {
        updateCriterion(crit.id, input.value.trim() || crit.text, client.id);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Remove criterion';
      removeBtn.addEventListener('click', () => deleteCriterion(crit.id, client.id));

      li.appendChild(input);
      li.appendChild(removeBtn);
      critList.appendChild(li);
    });
    detailEl.appendChild(critList);

    if (!client.criteria || !client.criteria.length) {
      const emptyHint = document.createElement('p');
      emptyHint.className = 'hint';
      emptyHint.textContent = 'No criteria yet — add at least one below.';
      detailEl.appendChild(emptyHint);
    }

    const critForm = document.createElement('form');
    critForm.className = 'criteria-form';
    const critInput = document.createElement('input');
    critInput.type = 'text';
    critInput.placeholder = 'Add a criterion for this client…';
    critInput.autocomplete = 'off';
    const critBtn = document.createElement('button');
    critBtn.type = 'submit';
    critBtn.className = 'btn btn-secondary';
    critBtn.textContent = 'Add';
    critForm.appendChild(critInput);
    critForm.appendChild(critBtn);
    critForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = critInput.value.trim();
      if (!text) return;
      await fetch(`/api/clients/${client.id}/criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      await refreshDetail(client.id);
    });
    detailEl.appendChild(critForm);
  }

  async function refreshDetail(clientId) {
    const res = await fetch(`/api/clients/${clientId}`);
    if (res.ok) renderDetail(await res.json());
  }

  async function saveClientField(id, patch) {
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        alert(`Could not save: ${detail}`);
      }
    } finally {
      await loadClients();
    }
  }

  async function uploadLogo(id, file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/clients/${id}/logo`, { method: 'POST', body: formData });
      if (res.ok) {
        renderDetail(await res.json());
      } else {
        const detail = await res.text().catch(() => res.statusText);
        alert(`Logo upload failed: ${detail}`);
      }
    } catch (err) {
      alert(`Logo upload failed: ${err.message}`);
    }
  }

  async function updateCriterion(criterionId, text, clientId) {
    await fetch(`/api/criteria/${criterionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    await refreshDetail(clientId);
  }

  async function deleteCriterion(criterionId, clientId) {
    await fetch(`/api/criteria/${criterionId}`, { method: 'DELETE' });
    await refreshDetail(clientId);
  }

  async function deleteClient(id) {
    if (!confirm('Delete this client and all of their saved criteria? Reviews already saved for this client are kept, but will show as having no client. This cannot be undone.')) return;
    await fetch(`/api/clients/${id}`, { method: 'DELETE' });
    selectedId = null;
    detailEl.innerHTML = '<p class="hint">Select a client on the left, or add a new one, to manage their criteria and branding.</p>';
    await loadClients();
  }

  loadClients();
})();
