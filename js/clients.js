/**
 * clients.js
 * ----------
 * UI wiring for the Manage Clients page: create/edit/delete clients, upload
 * a branding logo, and manage each client's image categories (Reel/Animation,
 * Flyer, etc.) and the criteria saved under each one. These are what
 * auto-loads on the main Review page when that client + category is
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

    // Categories + criteria
    const categoriesHeading = document.createElement('h3');
    categoriesHeading.className = 'detail-subheading';
    categoriesHeading.textContent = 'Image categories & criteria';
    detailEl.appendChild(categoriesHeading);

    const categoriesHint = document.createElement('p');
    categoriesHint.className = 'hint';
    categoriesHint.textContent = 'Each category has its own criteria. On the Review page, picking this client then a category loads that category\'s criteria automatically.';
    detailEl.appendChild(categoriesHint);

    const categoriesWrap = document.createElement('div');
    categoriesWrap.className = 'category-list';
    (client.categories || []).forEach((cat) => {
      categoriesWrap.appendChild(renderCategorySection(cat, client));
    });
    detailEl.appendChild(categoriesWrap);

    const addCatForm = document.createElement('form');
    addCatForm.className = 'criteria-form add-category-form';
    const addCatInput = document.createElement('input');
    addCatInput.type = 'text';
    addCatInput.placeholder = 'New category name (e.g. Banner Ad)…';
    addCatInput.autocomplete = 'off';
    const addCatBtn = document.createElement('button');
    addCatBtn.type = 'submit';
    addCatBtn.className = 'btn btn-secondary';
    addCatBtn.textContent = '+ Add Category';
    addCatForm.appendChild(addCatInput);
    addCatForm.appendChild(addCatBtn);
    addCatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = addCatInput.value.trim();
      if (!name) return;
      await fetch(`/api/clients/${client.id}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await refreshDetail(client.id);
    });
    detailEl.appendChild(addCatForm);
  }

  function renderCategorySection(cat, client) {
    const section = document.createElement('div');
    section.className = 'category-section';

    const header = document.createElement('div');
    header.className = 'category-section-header';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'text-input category-name-input';
    nameInput.value = cat.name;
    nameInput.addEventListener('change', async () => {
      const name = nameInput.value.trim() || cat.name;
      await fetch(`/api/categories/${cat.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await refreshDetail(client.id);
    });

    const deleteCatBtn = document.createElement('button');
    deleteCatBtn.type = 'button';
    deleteCatBtn.className = 'btn btn-danger btn-small';
    deleteCatBtn.textContent = 'Delete category';
    deleteCatBtn.addEventListener('click', async () => {
      if (!confirm(`Delete the "${cat.name}" category and all its criteria? This cannot be undone.`)) return;
      await fetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
      await refreshDetail(client.id);
    });

    header.appendChild(nameInput);
    header.appendChild(deleteCatBtn);
    section.appendChild(header);

    const critList = document.createElement('ul');
    critList.className = 'criteria-list';
    (cat.criteria || []).forEach((crit) => {
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
    section.appendChild(critList);

    if (!cat.criteria || !cat.criteria.length) {
      const emptyHint = document.createElement('p');
      emptyHint.className = 'hint';
      emptyHint.textContent = 'No criteria yet for this category.';
      section.appendChild(emptyHint);
    }

    const critForm = document.createElement('form');
    critForm.className = 'criteria-form';
    const critInput = document.createElement('input');
    critInput.type = 'text';
    critInput.placeholder = `Add a criterion for ${cat.name}…`;
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
      await fetch(`/api/categories/${cat.id}/criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      await refreshDetail(client.id);
    });
    section.appendChild(critForm);

    return section;
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
    if (!confirm('Delete this client and all of their categories/criteria? Reviews already saved for this client are kept, but will show as having no client. This cannot be undone.')) return;
    await fetch(`/api/clients/${id}`, { method: 'DELETE' });
    selectedId = null;
    detailEl.innerHTML = '<p class="hint">Select a client on the left, or add a new one, to manage their categories and criteria.</p>';
    await loadClients();
  }

  loadClients();
})();
