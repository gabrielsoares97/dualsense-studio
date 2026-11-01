import { h, block, button, notice } from '../ui.js';
import { normalizeConfig, assignConfig, defaultConfig } from '../state.js';

const api = {
  async list() { const r = await fetch('/api/profiles'); if (!r.ok) throw new Error('servidor'); return r.json(); },
  async get(name) { const r = await fetch('/api/profiles/' + encodeURIComponent(name)); if (!r.ok) throw new Error('não encontrado'); return r.json(); },
  async put(name, data) { const r = await fetch('/api/profiles/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok) throw new Error((await r.json()).error); },
  async del(name) { await fetch('/api/profiles/' + encodeURIComponent(name), { method: 'DELETE' }); },
};

const download = (name, data) => {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: name + '.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export default {
  id: 'profiles',
  label: 'Perfis',
  title: 'Perfis',
  desc: 'Guarde a configuração inteira (gatilhos, luzes, áudio, microfone, energia e Modo PC) com um nome e troque com um clique. A última configuração usada é restaurada sozinha ao abrir o programa.',
  build(app) {
    const msg = notice('');
    const list = h('div', { class: 'profile-list' });
    const nameInput = h('input', { type: 'text', placeholder: 'Ex.: Tiro, Corrida, Filme', maxlength: 60, 'aria-label': 'Nome do perfil' });

    const load = (data, label) => {
      assignConfig(app.cfg, normalizeConfig(data));
      app.save();
      app.apply();
      app.refreshAll();
      app.toast(`Perfil "${label}" aplicado`);
    };

    const refresh = async () => {
      try {
        const items = await api.list();
        list.replaceChildren(...(items.length ? items.map((p) => h('div', { class: 'profile' },
          h('span', { class: 'pname' }, p.name),
          h('span', { class: 'pdate' }, new Date(p.mtime).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })),
          button('Aplicar', async () => load(await api.get(p.name), p.name), { variant: 'primary' }),
          button('Sobrescrever', async () => { await api.put(p.name, app.cfg); app.toast(`Perfil "${p.name}" atualizado`); refresh(); }),
          button('Exportar', async () => download(p.name, await api.get(p.name)), { variant: 'ghost' }),
          button('Excluir', async () => { if (confirm(`Excluir o perfil "${p.name}"?`)) { await api.del(p.name); refresh(); } }, { variant: 'ghost danger' }),
        )) : [h('p', { class: 'hint' }, 'Nenhum perfil salvo ainda. Configure o controle e salve o primeiro acima.')]));
        msg.set('');
      } catch {
        msg.set('Os perfis ficam na pasta "perfis" e precisam do servidor local. Abra o programa pelo "Iniciar DualSense Studio.bat". Exportar e importar arquivos continua funcionando.', 'warn');
      }
    };

    const save = async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      try { await api.put(name, app.cfg); nameInput.value = ''; app.toast(`Perfil "${name}" salvo`); refresh(); } catch (e) { msg.set('Não foi possível salvar: ' + e.message, 'error'); }
    };
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && save());

    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      try { load(JSON.parse(await f.text()), f.name.replace(/\.json$/i, '')); } catch (e) { msg.set('Arquivo inválido: ' + e.message, 'error'); }
    });

    const el = h('div', {},
      block('Salvar a configuração atual', '',
        h('div', { class: 'row' }, h('div', { style: { flex: '1', minWidth: '220px' } }, nameInput), button('Salvar perfil', save, { variant: 'primary' }))),
      block('Perfis salvos', '', msg, list),
      block('Arquivos', 'Leve seus perfis para outro PC ou compartilhe com amigos.',
        h('div', { class: 'row' },
          button('Exportar configuração atual', () => download('dualsense-config', app.cfg)),
          button('Importar de arquivo', () => fileInput.click()),
          fileInput)),
      block('Padrão de fábrica', 'Volta tudo para os valores iniciais do DualSense Studio.',
        button('Restaurar padrão', () => { if (confirm('Restaurar todas as configurações para o padrão?')) load(defaultConfig(), 'Padrão'); }, { variant: 'danger' })),
    );
    return { el, show: refresh };
  },
};
