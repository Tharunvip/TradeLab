// TradeLab — File & workspace Explorer tree manager
// Virtual tree: root groups -> categories (Charts/Setups/Strategies/Templates/Journal) with files/folders; supports CRUD, context-menu, drag-drop, search, sort.

export class FileManager {
  constructor({ storage, onChange }) {
    this.storage = storage;
    this.onChange = onChange || (()=>{});
    this.tree = [];
    this.selected = null;
    this.query = '';
    this.sort = 'name-asc';
  }

  async init() {
    let saved = null;
    try { saved = await this.storage.get('files','tree'); } catch {}
    if (!saved?.children) this.tree = defaultTree();
    else this.tree = saved.children;
    this._emit('init');
    return this;
  }

  async _persist() {
    await this.storage.set('files', 'tree', { id:'tree', children: this.tree });
  }

  listFlat(group = null) {
    const out = [];
    const walk = (nodes, parent) => {
      for (const n of nodes) {
        if (!group || n._group === group || parent?._group === group) out.push({...n, _parent: parent?.id || null});
        if (n.type === 'folder' && n.children) walk(n.children, n);
      }
    };
    walk(this.tree, null);
    let arr = out;
    if (this.query) {
      const q = this.query.toLowerCase();
      arr = arr.filter(n => n.name.toLowerCase().includes(q));
    }
    const [f, dir] = this.sort.split('-');
    arr.sort((a,b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      const A = a[f==='name'?'name':f==='date'?'updatedAt':'name'];
      const B = b[f==='name'?'name':f==='date'?'updatedAt':'name'];
      if (typeof A === 'number' && typeof B === 'number') return dir === 'asc' ? A - B : B - A;
      return dir === 'asc' ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
    });
    return arr;
  }
  groups(){ return this.tree.map(g => ({ id:g.id, name:g.name, icon:g.icon, count: countFiles(g) })); }

  find(id){ return findInTree(this.tree, id); }

  async createFile(parentId, name, props = {}) {
    const parent = findInTree(this.tree, parentId) ?? this.tree.find(g => g.id === 'charts') ?? this.tree[0];
    const file = {
      id: 'f_' + Math.random().toString(36).slice(2,9),
      type: 'file',
      name,
      kind: props.kind || 'chart',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      meta: props.meta || {},
      _group: parent._group || parent.id,
    };
    parent.children = parent.children || [];
    parent.children.push(file);
    await this._persist();
    this._emit('createFile');
    return file;
  }

  async createFolder(parentId, name) {
    const parent = findInTree(this.tree, parentId) ?? this.tree[0];
    const folder = {
      id: 'd_' + Math.random().toString(36).slice(2,9),
      type: 'folder',
      name,
      children: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      _group: parent._group || parent.id,
      expanded: true,
    };
    parent.children.push(folder);
    await this._persist();
    this._emit('createFolder');
    return folder;
  }

  async rename(id, name) {
    const n = findInTree(this.tree, id); if (!n) return false;
    n.name = name; n.updatedAt = Date.now();
    await this._persist();
    this._emit('rename');
    return true;
  }

  async duplicate(id) {
    const n = findInTree(this.tree, id); if (!n) return null;
    const parent = findParent(this.tree, id); if (!parent) return null;
    const copy = structuredClone(n);
    reid(copy);
    copy.name = n.name + ' Copy';
    copy.updatedAt = Date.now();
    parent.children.push(copy);
    await this._persist();
    this._emit('duplicate');
    return copy;
  }

  async remove(id) {
    const parent = findParent(this.tree, id); if (!parent) return false;
    const i = parent.children.findIndex(c => c.id === id); if (i<0) return false;
    parent.children.splice(i,1);
    if (this.selected === id) this.selected = null;
    await this._persist();
    this._emit('delete');
    return true;
  }

  async move(id, newParentId) {
    const node = findInTree(this.tree, id); if (!node) return false;
    const curParent = findParent(this.tree, id);
    const newParent = findInTree(this.tree, newParentId); if (!newParent) return false;
    if (newParent.type !== 'folder') return false;
    const i = curParent.children.findIndex(c => c.id === id);
    const [moved] = curParent.children.splice(i,1);
    newParent.children = newParent.children || [];
    newParent.children.push(moved);
    await this._persist();
    this._emit('move');
    return true;
  }

  exportJSON(nodeId){
    const n = findInTree(this.tree, nodeId); if (!n) return null;
    return { __type:'tp.file', version:1, exportedAt:Date.now(), node: structuredClone(n) };
  }

  setQuery(q){ this.query = q || ''; this._emit('query'); }
  setSort(s){ this.sort = s; this._emit('sort'); }
  select(id){ this.selected = id; this._emit('select'); }
  toggleExpand(id){
    const n = findInTree(this.tree, id); if (n && n.type === 'folder') { n.expanded = !n.expanded; this._emit('expand'); }
  }

  _emit(kind){ try { this.onChange?.(kind, this); } catch(err) { console.error('[TP ERROR] file-manager onChange:', err); } }
}

function defaultTree() {
  const groups = [
    { id:'charts',     name:'Charts',     type:'folder', icon:'📊', expanded:true,  children: [] },
    { id:'setups',     name:'Setups',     type:'folder', icon:'🎯', expanded:true,  children: [] },
    { id:'strategies', name:'Strategies', type:'folder', icon:'🧠', expanded:false, children: [] },
    { id:'templates',  name:'Templates',  type:'folder', icon:'📑', expanded:false, children: [] },
    { id:'journal',    name:'Journal',    type:'folder', icon:'📓', expanded:false, children: [] },
  ];
  for (const g of groups) g._group = g.id;
  return groups;
}

function findInTree(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.type === 'folder' && n.children) { const r = findInTree(n.children, id); if (r) return r; }
  }
  return null;
}
function findParent(nodes, id, parent = null) {
  for (const n of nodes) {
    if (n.id === id) return parent ? (parent.children ? parent : { children: nodes }) : null;
    if (n.type === 'folder' && n.children) { const r = findParent(n.children, id, n); if (r) return r; }
  }
  return null;
}
function countFiles(g){
  let c = 0;
  if (g.children) for (const n of g.children) c += n.type === 'file' ? 1 : countFiles(n);
  return c;
}
function reid(node){
  node.id = (node.type === 'folder' ? 'd_' : 'f_') + Math.random().toString(36).slice(2,9);
  if (node.children) for (const c of node.children) reid(c);
}
