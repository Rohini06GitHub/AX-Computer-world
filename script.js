/* =========================================================
   TaskFlow — vanilla JS task manager
   Features: CRUD · priorities · due dates · categories ·
   search · filters · sort · drag&drop · dark mode ·
   stats · localStorage · import/export · toasts · undo
   ========================================================= */

const LS_TASKS = 'taskflow.tasks.v1';
const LS_THEME = 'taskflow.theme.v1';
const LS_PREFS = 'taskflow.prefs.v1';

/* ---------- STATE ---------- */
let tasks = [];
let prefs = { status:'all', category:'all', priority:'all', sort:'manual', search:'' };
let editingId = null;
let dragId = null;
let confirmAction = null;

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const el = {
  form:$('taskForm'), title:$('title'), category:$('category'),
  priority:$('priority'), due:$('due'), formError:$('formError'),
  list:$('taskList'), empty:$('emptyState'), shownCount:$('shownCount'),
  search:$('search'), statusChips:$('statusChips'),
  filterCategory:$('filterCategory'), filterPriority:$('filterPriority'),
  sortBy:$('sortBy'), clearDone:$('clearDone'),
  statTotal:$('statTotal'), statActive:$('statActive'),
  statDone:$('statDone'), statOverdue:$('statOverdue'),
  progressFill:$('progressFill'), progressPct:$('progressPct'),
  categoryList:$('categoryList'),
  themeToggle:$('themeToggle'),
  editModal:$('editModal'), editForm:$('editForm'), editTitle:$('editTitle'),
  editNotes:$('editNotes'), editCategory:$('editCategory'),
  editPriority:$('editPriority'), editDue:$('editDue'),
  closeModal:$('closeModal'), cancelEdit:$('cancelEdit'),
  confirmModal:$('confirmModal'), confirmTitle:$('confirmTitle'),
  confirmText:$('confirmText'), confirmYes:$('confirmYes'), confirmNo:$('confirmNo'),
  toasts:$('toasts'),
  exportBtn:$('exportBtn'), importBtn:$('importBtn'), importFile:$('importFile')
};

/* ---------- HELPERS ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayISO = () => new Date().toISOString().slice(0, 10);
const escapeHTML = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

function daysUntil(dateStr){
  const a = new Date(todayISO() + 'T00:00:00');
  const b = new Date(dateStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function prettyDate(dateStr){
  const d = daysUntil(dateStr);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d <= 7) return `In ${d} days`;
  return new Date(dateStr + 'T00:00:00')
    .toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' });
}

const isOverdue = t => !t.completed && t.due && daysUntil(t.due) < 0;
const isSoon    = t => !t.completed && t.due && daysUntil(t.due) >= 0 && daysUntil(t.due) <= 2;

/* ---------- PERSISTENCE ---------- */
function save(){
  localStorage.setItem(LS_TASKS, JSON.stringify(tasks));
  localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
}
function load(){
  try { tasks = JSON.parse(localStorage.getItem(LS_TASKS)) || []; } catch { tasks = []; }
  try { prefs = { ...prefs, ...(JSON.parse(localStorage.getItem(LS_PREFS)) || {}) }; } catch {}
}

/* ---------- THEME ---------- */
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  el.themeToggle.querySelector('.theme-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(LS_THEME, theme);
}
el.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(`${next === 'dark' ? 'Dark' : 'Light'} mode on`, 'info');
});

/* ---------- TOASTS ---------- */
function toast(msg, type = 'success', actionLabel, actionFn, ms = 4000){
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<span>${escapeHTML(msg)}</span>`;
  if (actionLabel){
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { actionFn(); dismiss(); };
    node.appendChild(b);
  }
  el.toasts.appendChild(node);
  const timer = setTimeout(dismiss, ms);
  function dismiss(){
    clearTimeout(timer);
    node.classList.add('out');
    setTimeout(() => node.remove(), 250);
  }
}

/* ---------- CONFIRM DIALOG ---------- */
function confirmBox(title, text, onYes){
  el.confirmTitle.textContent = title;
  el.confirmText.textContent = text;
  confirmAction = onYes;
  el.confirmModal.classList.remove('hidden');
}
el.confirmNo.onclick = () => el.confirmModal.classList.add('hidden');
el.confirmYes.onclick = () => {
  el.confirmModal.classList.add('hidden');
  if (confirmAction) confirmAction();
  confirmAction = null;
};
el.confirmModal.onclick = e => { if (e.target === el.confirmModal) el.confirmModal.classList.add('hidden'); };

/* ---------- CRUD ---------- */
el.form.addEventListener('submit', e => {
  e.preventDefault();
  const title = el.title.value.trim();
  el.formError.textContent = '';

  if (!title){ el.formError.textContent = 'Please enter a task title.'; return; }
  if (tasks.some(t => t.title.toLowerCase() === title.toLowerCase() && !t.completed)){
    el.formError.textContent = 'An active task with that name already exists.';
    return;
  }

  tasks.unshift({
    id: uid(),
    title,
    notes: '',
    category: el.category.value.trim() || 'General',
    priority: el.priority.value,
    due: el.due.value || '',
    completed: false,
    createdAt: Date.now(),
    order: Date.now() * -1
  });

  el.form.reset();
  el.priority.value = 'medium';
  el.title.focus();
  save(); render();
  toast('Task added', 'success');
});

function toggleTask(id){
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.completed = !t.completed;
  t.completedAt = t.completed ? Date.now() : null;
  save(); render();
  if (t.completed) toast('Nice! Task completed 🎉', 'success');
}

function deleteTask(id){
  const idx = tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  const [removed] = tasks.splice(idx, 1);
  save(); render();
  toast('Task deleted', 'error', 'Undo', () => {
    tasks.splice(idx, 0, removed);
    save(); render();
    toast('Restored', 'info');
  });
}

function duplicateTask(id){
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const copy = { ...t, id: uid(), title: t.title + ' (copy)', completed:false, createdAt: Date.now() };
  tasks.unshift(copy);
  save(); render();
  toast('Task duplicated', 'info');
}

/* ---------- EDIT MODAL ---------- */
function openEdit(id){
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  editingId = id;
  el.editTitle.value = t.title;
  el.editNotes.value = t.notes || '';
  el.editCategory.value = t.category;
  el.editPriority.value = t.priority;
  el.editDue.value = t.due || '';
  el.editModal.classList.remove('hidden');
  setTimeout(() => el.editTitle.focus(), 60);
}
function closeEdit(){ el.editModal.classList.add('hidden'); editingId = null; }

el.editForm.addEventListener('submit', e => {
  e.preventDefault();
  const t = tasks.find(x => x.id === editingId);
  if (!t) return closeEdit();
  const title = el.editTitle.value.trim();
  if (!title) return;
  Object.assign(t, {
    title,
    notes: el.editNotes.value.trim(),
    category: el.editCategory.value.trim() || 'General',
    priority: el.editPriority.value,
    due: el.editDue.value || ''
  });
  save(); render(); closeEdit();
  toast('Changes saved', 'success');
});
el.closeModal.onclick = closeEdit;
el.cancelEdit.onclick = closeEdit;
el.editModal.onclick = e => { if (e.target === el.editModal) closeEdit(); };

/* ---------- FILTER / SORT ---------- */
el.search.addEventListener('input', () => { prefs.search = el.search.value.toLowerCase(); save(); render(); });

el.statusChips.addEventListener('click', e => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  prefs.status = btn.dataset.status;
  [...el.statusChips.children].forEach(c => c.classList.toggle('active', c === btn));
  save(); render();
});

el.filterCategory.addEventListener('change', () => { prefs.category = el.filterCategory.value; save(); render(); });
el.filterPriority.addEventListener('change', () => { prefs.priority = el.filterPriority.value; save(); render(); });
el.sortBy.addEventListener('change', () => { prefs.sort = el.sortBy.value; save(); render(); });

el.clearDone.addEventListener('click', () => {
  const done = tasks.filter(t => t.completed);
  if (!done.length) return toast('No completed tasks to clear', 'info');
  confirmBox('Clear completed?', `This will remove ${done.length} completed task(s).`, () => {
    const backup = [...tasks];
    tasks = tasks.filter(t => !t.completed);
    save(); render();
    toast(`${done.length} task(s) cleared`, 'error', 'Undo', () => {
      tasks = backup; save(); render();
    });
  });
});

function getVisible(){
  let out = tasks.filter(t => {
    if (prefs.search){
      const hay = (t.title + ' ' + (t.notes || '') + ' ' + t.category).toLowerCase();
      if (!hay.includes(prefs.search)) return false;
    }
    if (prefs.category !== 'all' && t.category !== prefs.category) return false;
    if (prefs.priority !== 'all' && t.priority !== prefs.priority) return false;
    if (prefs.status === 'active' && t.completed) return false;
    if (prefs.status === 'completed' && !t.completed) return false;
    if (prefs.status === 'overdue' && !isOverdue(t)) return false;
    return true;
  });

  switch (prefs.sort){
    case 'created-desc': out.sort((a,b) => b.createdAt - a.createdAt); break;
    case 'created-asc':  out.sort((a,b) => a.createdAt - b.createdAt); break;
    case 'az':           out.sort((a,b) => a.title.localeCompare(b.title)); break;
    case 'priority-desc':out.sort((a,b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]); break;
    case 'due-asc':      out.sort((a,b) => {
                            if (!a.due) return 1;
                            if (!b.due) return -1;
                            return a.due.localeCompare(b.due);
                         }); break;
    default: /* manual = array order */ break;
  }
  return out;
}

/* ---------- RENDER ---------- */
function render(){
  // category options + datalist
  const cats = [...new Set(tasks.map(t => t.category).filter(Boolean))].sort();
  el.filterCategory.innerHTML = '<option value="all">All categories</option>' +
    cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  if (cats.includes(prefs.category)) el.filterCategory.value = prefs.category;
  else prefs.category = 'all';
  el.categoryList.innerHTML = cats.map(c => `<option value="${escapeHTML(c)}">`).join('');

  // sync controls
  el.filterPriority.value = prefs.priority;
  el.sortBy.value = prefs.sort;
  el.search.value = prefs.search;
  [...el.statusChips.children].forEach(c => c.classList.toggle('active', c.dataset.status === prefs.status));

  // stats
  const total = tasks.length;
  const done = tasks.filter(t => t.completed).length;
  const overdue = tasks.filter(isOverdue).length;
  el.statTotal.textContent = total;
  el.statActive.textContent = total - done;
  el.statDone.textContent = done;
  el.statOverdue.textContent = overdue;
  const pct = total ? Math.round(done / total * 100) : 0;
  el.progressFill.style.width = pct + '%';
  el.progressPct.textContent = pct + '%';

  // list
  const visible = getVisible();
  el.shownCount.textContent = `${visible.length} shown`;
  el.list.innerHTML = '';
  el.empty.classList.toggle('hidden', visible.length > 0);

  const canDrag = prefs.sort === 'manual';

  visible.forEach(t => {
    const li = document.createElement('li');
    li.className = `task p-${t.priority}${t.completed ? ' done' : ''}`;
    li.dataset.id = t.id;
    li.draggable = canDrag;

    li.innerHTML = `
      ${canDrag ? '<span class="drag-handle" title="Drag to reorder">⠿</span>' : ''}
      <input type="checkbox" class="checkbox" ${t.completed ? 'checked' : ''} aria-label="Toggle complete">
      <div class="task-main">
        <div class="task-title">${escapeHTML(t.title)}</div>
        ${t.notes ? `<div class="task-notes">${escapeHTML(t.notes)}</div>` : ''}
        <div class="meta">
          <span class="tag cat">📁 ${escapeHTML(t.category)}</span>
          <span class="tag ${t.priority}">${t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢'} ${t.priority}</span>
          ${t.due ? `<span class="tag ${isOverdue(t) ? 'overdue' : isSoon(t) ? 'soon' : ''}">📅 ${prettyDate(t.due)}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="act edit" title="Edit">✏️</button>
        <button class="act dup" title="Duplicate">⧉</button>
        <button class="act del" title="Delete">🗑️</button>
      </div>`;

    li.querySelector('.checkbox').onclick = () => toggleTask(t.id);
    li.querySelector('.edit').onclick = () => openEdit(t.id);
    li.querySelector('.dup').onclick  = () => duplicateTask(t.id);
    li.querySelector('.del').onclick  = () =>
      confirmBox('Delete task?', `"${t.title}" will be removed.`, () => deleteTask(t.id));

    if (canDrag) attachDnD(li);
    el.list.appendChild(li);
  });
}

/* ---------- DRAG & DROP ---------- */
function attachDnD(li){
  li.addEventListener('dragstart', e => {
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(n => n.classList.remove('drag-over'));
    dragId = null;
  });
  li.addEventListener('dragover', e => {
    e.preventDefault();
    if (li.dataset.id !== dragId) li.classList.add('drag-over');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
  li.addEventListener('drop', e => {
    e.preventDefault();
    li.classList.remove('drag-over');
    const targetId = li.dataset.id;
    if (!dragId || dragId === targetId) return;
    const from = tasks.findIndex(t => t.id === dragId);
    const to   = tasks.findIndex(t => t.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = tasks.splice(from, 1);
    tasks.splice(to, 0, moved);
    save(); render();
  });
}

/* ---------- IMPORT / EXPORT ---------- */
el.exportBtn.onclick = () => {
  if (!tasks.length) return toast('Nothing to export', 'info');
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `taskflow-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported JSON', 'success');
};

el.importBtn.onclick = () => el.importFile.click();
el.importFile.onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('bad');
      const cleaned = data.filter(d => d && d.title).map(d => ({
        id: d.id || uid(),
        title: String(d.title),
        notes: d.notes || '',
        category: d.category || 'General',
        priority: ['low','medium','high'].includes(d.priority) ? d.priority : 'medium',
        due: d.due || '',
        completed: !!d.completed,
        createdAt: d.createdAt || Date.now()
      }));
      tasks = [...cleaned, ...tasks];
      save(); render();
      toast(`Imported ${cleaned.length} task(s)`, 'success');
    } catch {
      toast('Invalid JSON file', 'error');
    }
    el.importFile.value = '';
  };
  reader.readAsText(file);
};

/* ---------- KEYBOARD SHORTCUTS ---------- */
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA'){
    e.preventDefault(); el.search.focus();
  }
  if (e.key === 'Escape'){
    closeEdit();
    el.confirmModal.classList.add('hidden');
  }
});

/* ---------- INIT ---------- */
(function init(){
  applyTheme(localStorage.getItem(LS_THEME)
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  load();

  if (!tasks.length && !localStorage.getItem(LS_TASKS)){
    const t = new Date(); t.setDate(t.getDate() + 2);
    tasks = [
      { id:uid(), title:'Welcome to TaskFlow 👋', notes:'Click ✏️ to edit, drag ⠿ to reorder, tick the box when done.',
        category:'Getting started', priority:'high', due:todayISO(), completed:false, createdAt:Date.now() },
      { id:uid(), title:'Try the dark mode toggle', notes:'', category:'Getting started',
        priority:'medium', due:t.toISOString().slice(0,10), completed:false, createdAt:Date.now()-1000 },
      { id:uid(), title:'Explore filters & sorting', notes:'', category:'Getting started',
        priority:'low', due:'', completed:true, createdAt:Date.now()-2000 }
    ];
    save();
  }

  el.due.min = todayISO();
  render();
  el.title.focus();
})();
