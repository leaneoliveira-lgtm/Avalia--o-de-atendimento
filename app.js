/* =========================================================
   Qualidade+ — Sistema de Avaliação de Atendimentos Internos
   ========================================================= */

// [FIXO] Credenciais do Supabase — antes eram digitadas pelo usuário na tela
// de login (campos cfgUrl/cfgKey) e salvas em localStorage. Agora ficam
// fixas aqui no código, já que a tela de login não coleta mais isso.
const SUPABASE_URL = 'https://exlnqvjpqihhsgvztoef.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YQCPiatRyL66R8cE5nc6HQ_glpUL_rg';

// [FIXO] Logo da empresa — antes era uma URL opcional digitada na tela de
// login (campo cfgLogo). Defina aqui o link da imagem da logo quando tiver.
const COMPANY_LOGO_URL = '';

// [NOVO] Autenticação local simples — substitui por completo a etapa em que
// o usuário informava URL + chave do Supabase para "entrar" no sistema.
// Não usa Supabase Auth, banco de dados, usuários ou e-mails: é apenas uma
// senha fixa comparada no navegador, guardando um flag de sessão local.
const LOGIN_SENHA = 'conexao2026';
const LOGIN_SESSION_KEY = 'qplus_sessao_ativa';

let sb = null;
let STATE = {
  colaboradores: [],
  criterios: [],
  atendimentos: [], // cache da última listagem (com joins)
  charts: {},
  logoUrl: COMPANY_LOGO_URL,
  relatorioAtual: null // dados do último relatório gerado (usado nas exportações)
};

/* ---------------------------------------------------------
   CONEXÃO SUPABASE (fixa, sem interação do usuário)
--------------------------------------------------------- */
// [REMOVIDO] initSupabaseFromStorage() lia sb_url/sb_key do localStorage
// (preenchidos pelo usuário na tela "Conectar ao Supabase"). Substituída
// por uma inicialização direta com as constantes fixas acima.
function initSupabaseClient() {
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------------------
   LOGIN LOCAL (senha fixa, sem Supabase Auth)
--------------------------------------------------------- */
// [SUBSTITUÍDO] O antigo listener de 'configForm' testava a conexão com o
// Supabase (testClient.from('colaboradores').select(...)) e só liberava o
// acesso se a consulta funcionasse. Agora ele apenas compara a senha
// digitada com LOGIN_SENHA — não há chamada ao Supabase nesta etapa.
document.getElementById('configForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const senha = document.getElementById('loginSenha').value;
  const errEl = document.getElementById('configError');
  errEl.textContent = '';

  if (senha !== LOGIN_SENHA) {
    errEl.textContent = 'Senha inválida.';
    return;
  }

  localStorage.setItem(LOGIN_SESSION_KEY, '1');
  initSupabaseClient();
  startApp();
});

// [SUBSTITUÍDO] Antes removia sb_url/sb_key do localStorage (forçando nova
// configuração do Supabase). Agora só encerra a sessão de senha local.
document.getElementById('btnReconfigure').addEventListener('click', () => {
  localStorage.removeItem(LOGIN_SESSION_KEY);
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loginSenha').value = '';
  document.getElementById('configOverlay').style.display = 'flex';
});

/* ---------------------------------------------------------
   BOOT
--------------------------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  // [SUBSTITUÍDO] Antes: if (initSupabaseFromStorage()) startApp() — só
  // entrava direto se já houvesse URL/chave salvas. Agora: só entra direto
  // se a sessão de senha local já estiver marcada como ativa.
  if (localStorage.getItem(LOGIN_SESSION_KEY) === '1') {
    initSupabaseClient();
    startApp();
  }

  const logoMark = document.getElementById('loginLogoMark');
  if (COMPANY_LOGO_URL && logoMark) {
    logoMark.innerHTML = `<img src="${COMPANY_LOGO_URL}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain">`;
  }
});

async function startApp() {
  document.getElementById('configOverlay').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('fData').valueAsDate = new Date();

  setupNav();
  setupFormAtendimento();
  setupModais();
  setupFiltros();
  setupRelatorio();

  await Promise.all([loadColaboradores(), loadCriterios()]);
  await loadAtendimentos();
  await renderDashboard();
}

/* ---------------------------------------------------------
   NAVEGAÇÃO
--------------------------------------------------------- */
function setupNav() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => goToView(btn.dataset.view));
  });
}
function goToView(view) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  if (view === 'dashboard') renderDashboard();
}

/* ---------------------------------------------------------
   TOAST
--------------------------------------------------------- */
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('toast-error', isError);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ---------------------------------------------------------
   HELPERS DE NOTA / VISUAL
--------------------------------------------------------- */
function scoreColor(score) {
  if (score >= 8) return 'good';
  if (score >= 6) return 'warn';
  return 'bad';
}
function scoreBadgeHtml(score) {
  if (score === null || score === undefined) return '<span class="score-badge">–</span>';
  const cls = scoreColor(score);
  return `<span class="score-badge score-${cls}">${Number(score).toFixed(1)}</span>`;
}
function paintRing(el, score) {
  const cls = scoreColor(score);
  const colorVar = { good: '#16A34A', warn: '#D97706', bad: '#DC2626' }[cls];
  el.style.setProperty('--ring-color', colorVar);
  el.style.setProperty('--pct', Math.max(0, Math.min(100, (score / 10) * 100)) + '%');
}
function fmtDate(d) {
  if (!d) return '–';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('pt-BR');
}
function tipoLabel(t) { return t === 'chat' ? 'Chat' : 'Ligação'; }

/* ---------------------------------------------------------
   COLABORADORES
--------------------------------------------------------- */
async function loadColaboradores() {
  const { data, error } = await sb.from('colaboradores').select('*').order('nome');
  if (error) { toast('Erro ao carregar colaboradores: ' + error.message, true); return; }
  STATE.colaboradores = data || [];
  renderColaboradoresTable();
  renderColaboradorSelects();
}

function renderColaboradoresTable() {
  const tbody = document.getElementById('tabelaColaboradores');
  if (!STATE.colaboradores.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Nenhum colaborador cadastrado ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = STATE.colaboradores.map(c => `
    <tr>
      <td><strong>${escapeHtml(c.nome)}</strong></td>
      <td>${escapeHtml(c.setor || '–')}</td>
      <td>${escapeHtml(c.cargo || '–')}</td>
      <td><span class="pill ${c.ativo ? 'pill-ativo' : 'pill-inativo'}">${c.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td style="text-align:right">
        <button class="row-link" onclick="editColaborador('${c.id}')">Editar</button>
        &nbsp;·&nbsp;
        <button class="row-link" onclick="toggleColaborador('${c.id}', ${c.ativo})">${c.ativo ? 'Desativar' : 'Ativar'}</button>
      </td>
    </tr>
  `).join('');
}

function renderColaboradorSelects() {
  const ativos = STATE.colaboradores.filter(c => c.ativo);
  const optsForm = ativos.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  document.getElementById('fColaborador').innerHTML = '<option value="">Selecione</option>' + optsForm;

  const optsFilter = STATE.colaboradores.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  document.getElementById('filtroColaborador').innerHTML = '<option value="">Todos os colaboradores</option>' + optsFilter;

  // Relatório de Desempenho
  const setores = [...new Set(STATE.colaboradores.map(c => c.setor).filter(Boolean))].sort();
  const relSetorEl = document.getElementById('relSetor');
  const setorAtual = relSetorEl.value;
  relSetorEl.innerHTML = '<option value="">Todos os setores</option>' + setores.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  relSetorEl.value = setorAtual;
  renderRelColaboradorSelect();
}

function renderRelColaboradorSelect() {
  const setorF = document.getElementById('relSetor').value;
  const relColabEl = document.getElementById('relColaborador');
  const atual = relColabEl.value;
  const lista = STATE.colaboradores.filter(c => !setorF || c.setor === setorF);
  relColabEl.innerHTML = '<option value="">Selecione o colaborador</option>' + lista.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  if (lista.some(c => c.id === atual)) relColabEl.value = atual;
}

window.editColaborador = function (id) {
  const c = STATE.colaboradores.find(x => x.id === id);
  if (!c) return;
  document.getElementById('modalColaboradorTitulo').textContent = 'Editar colaborador';
  document.getElementById('colabId').value = c.id;
  document.getElementById('colabNome').value = c.nome;
  document.getElementById('colabSetor').value = c.setor || '';
  document.getElementById('colabCargo').value = c.cargo || '';
  openModal('modalColaborador');
};

window.toggleColaborador = async function (id, ativoAtual) {
  const { error } = await sb.from('colaboradores').update({ ativo: !ativoAtual }).eq('id', id);
  if (error) { toast('Erro ao atualizar: ' + error.message, true); return; }
  toast('Colaborador atualizado.');
  await loadColaboradores();
};

/* ---------------------------------------------------------
   CRITÉRIOS
--------------------------------------------------------- */
async function loadCriterios() {
  const { data, error } = await sb.from('criterios_avaliacao').select('*').order('ordem').order('nome');
  if (error) { toast('Erro ao carregar critérios: ' + error.message, true); return; }
  STATE.criterios = data || [];
  renderCriteriosTable();
}

function renderCriteriosTable() {
  const tbody = document.getElementById('tabelaCriterios');
  if (!STATE.criterios.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Nenhum critério cadastrado ainda.</td></tr>';
    return;
  }
  const tipoTxt = { chat: 'Somente Chat', ligacao: 'Somente Ligação', ambos: 'Chat e Ligação' };
  tbody.innerHTML = STATE.criterios.map(c => `
    <tr>
      <td><strong>${escapeHtml(c.nome)}</strong>${c.descricao ? `<br><span style="color:var(--text-muted);font-size:12px">${escapeHtml(c.descricao)}</span>` : ''}</td>
      <td>${tipoTxt[c.tipo_atendimento]}</td>
      <td class="mono">${Number(c.peso).toFixed(1)}</td>
      <td><span class="pill ${c.ativo ? 'pill-ativo' : 'pill-inativo'}">${c.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td style="text-align:right">
        <button class="row-link" onclick="editCriterio('${c.id}')">Editar</button>
        &nbsp;·&nbsp;
        <button class="row-link" onclick="toggleCriterio('${c.id}', ${c.ativo})">${c.ativo ? 'Desativar' : 'Ativar'}</button>
      </td>
    </tr>
  `).join('');
}

window.editCriterio = function (id) {
  const c = STATE.criterios.find(x => x.id === id);
  if (!c) return;
  document.getElementById('modalCriterioTitulo').textContent = 'Editar critério';
  document.getElementById('critId').value = c.id;
  document.getElementById('critNome').value = c.nome;
  document.getElementById('critDescricao').value = c.descricao || '';
  document.getElementById('critPeso').value = c.peso;
  document.getElementById('critTipo').value = c.tipo_atendimento;
  openModal('modalCriterio');
};

window.toggleCriterio = async function (id, ativoAtual) {
  const { error } = await sb.from('criterios_avaliacao').update({ ativo: !ativoAtual }).eq('id', id);
  if (error) { toast('Erro ao atualizar: ' + error.message, true); return; }
  toast('Critério atualizado.');
  await loadCriterios();
};

/* ---------------------------------------------------------
   MODAIS (colaborador / critério / detalhe)
--------------------------------------------------------- */
function setupModais() {
  document.getElementById('btnNovoColaborador').addEventListener('click', () => {
    document.getElementById('formColaborador').reset();
    document.getElementById('colabId').value = '';
    document.getElementById('modalColaboradorTitulo').textContent = 'Novo colaborador';
    openModal('modalColaborador');
  });
  document.getElementById('btnNovoCriterio').addEventListener('click', () => {
    document.getElementById('formCriterio').reset();
    document.getElementById('critId').value = '';
    document.getElementById('modalCriterioTitulo').textContent = 'Novo critério';
    openModal('modalCriterio');
  });
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.modal-overlay').classList.remove('active'));
  });
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('active'); });
  });

  document.getElementById('formColaborador').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('colabId').value;
    const payload = {
      nome: document.getElementById('colabNome').value.trim(),
      setor: document.getElementById('colabSetor').value.trim() || null,
      cargo: document.getElementById('colabCargo').value.trim() || null,
    };
    let error;
    if (id) {
      ({ error } = await sb.from('colaboradores').update(payload).eq('id', id));
    } else {
      ({ error } = await sb.from('colaboradores').insert(payload));
    }
    if (error) { toast('Erro ao salvar: ' + error.message, true); return; }
    toast('Colaborador salvo.');
    document.getElementById('modalColaborador').classList.remove('active');
    await loadColaboradores();
  });

  document.getElementById('formCriterio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('critId').value;
    const payload = {
      nome: document.getElementById('critNome').value.trim(),
      descricao: document.getElementById('critDescricao').value.trim() || null,
      peso: parseFloat(document.getElementById('critPeso').value),
      tipo_atendimento: document.getElementById('critTipo').value,
    };
    let error;
    if (id) {
      ({ error } = await sb.from('criterios_avaliacao').update(payload).eq('id', id));
    } else {
      ({ error } = await sb.from('criterios_avaliacao').insert(payload));
    }
    if (error) { toast('Erro ao salvar: ' + error.message, true); return; }
    toast('Critério salvo.');
    document.getElementById('modalCriterio').classList.remove('active');
    await loadCriterios();
    renderCriteriosDoFormulario();
  });
}
function openModal(id) { document.getElementById(id).classList.add('active'); }

/* ---------------------------------------------------------
   FORMULÁRIO — NOVA AVALIAÇÃO
--------------------------------------------------------- */
function setupFormAtendimento() {
  document.getElementById('fTipo').addEventListener('change', renderCriteriosDoFormulario);
  document.getElementById('btnLimparForm').addEventListener('click', resetFormAtendimento);
  document.getElementById('formAtendimento').addEventListener('submit', salvarAtendimento);
  document.getElementById('fPlaca').addEventListener('input', (e) => {
    const val = normalizarPlaca(e.target.value);
    const hint = document.getElementById('placaHint');
    if (!val) { hint.textContent = ''; return; }
    hint.textContent = placaValidaFormatoConhecido(val) ? '' : 'Formato não reconhecido — será salvo mesmo assim.';
  });
}

function renderCriteriosDoFormulario() {
  const tipo = document.getElementById('fTipo').value;
  const container = document.getElementById('criteriosContainer');
  const hint = document.getElementById('criteriosHint');

  if (!tipo) {
    container.innerHTML = '';
    hint.textContent = 'selecione o tipo de atendimento acima';
    updateNotaPreview();
    return;
  }
  const aplicaveis = STATE.criterios.filter(c => c.ativo && (c.tipo_atendimento === tipo || c.tipo_atendimento === 'ambos'));
  hint.textContent = `${aplicaveis.length} critério(s) aplicável(is)`;

  if (!aplicaveis.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13.5px">Nenhum critério ativo para este tipo de atendimento. Cadastre em "Critérios".</p>';
    return;
  }

  container.innerHTML = aplicaveis.map(c => `
    <div class="criterio-row" data-criterio-id="${c.id}" data-peso="${c.peso}">
      <div class="criterio-info">
        <strong>${escapeHtml(c.nome)}</strong>
        ${c.descricao ? `<span>${escapeHtml(c.descricao)}</span>` : ''}
      </div>
      <div class="criterio-slider">
        <input type="range" min="0" max="10" step="0.5" value="8" class="criterio-input">
        <span class="criterio-slider-val">8.0</span>
      </div>
      <div class="criterio-weight">peso ${Number(c.peso).toFixed(1)}</div>
    </div>
  `).join('');

  container.querySelectorAll('.criterio-row').forEach(row => {
    const input = row.querySelector('.criterio-input');
    const val = row.querySelector('.criterio-slider-val');
    input.addEventListener('input', () => {
      val.textContent = Number(input.value).toFixed(1);
      updateNotaPreview();
    });
  });

  updateNotaPreview();
}

function computeNotaFinal() {
  const rows = document.querySelectorAll('#criteriosContainer .criterio-row');
  if (!rows.length) return 0;
  let somaPesos = 0, somaPontos = 0;
  rows.forEach(row => {
    const peso = parseFloat(row.dataset.peso);
    const nota = parseFloat(row.querySelector('.criterio-input').value);
    somaPesos += peso;
    somaPontos += peso * nota;
  });
  return somaPesos ? somaPontos / somaPesos : 0;
}

function updateNotaPreview() {
  const nota = computeNotaFinal();
  document.getElementById('previewScore').textContent = nota.toFixed(1);
  paintRing(document.getElementById('previewRing'), nota);
}

function resetFormAtendimento() {
  document.getElementById('formAtendimento').reset();
  document.getElementById('fData').valueAsDate = new Date();
  document.getElementById('criteriosContainer').innerHTML = '';
  document.getElementById('criteriosHint').textContent = 'selecione o tipo de atendimento acima';
  document.getElementById('placaHint').textContent = '';
  updateNotaPreview();
}

async function salvarAtendimento(e) {
  e.preventDefault();
  const rows = document.querySelectorAll('#criteriosContainer .criterio-row');
  if (!rows.length) { toast('Selecione o tipo de atendimento e pontue os critérios.', true); return; }

  const btn = document.getElementById('btnSalvarAtendimento');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const notaFinal = computeNotaFinal();
  const payload = {
    colaborador_id: document.getElementById('fColaborador').value,
    avaliador: document.getElementById('fAvaliador').value.trim(),
    tipo_atendimento: document.getElementById('fTipo').value,
    data_atendimento: document.getElementById('fData').value,
    cliente: document.getElementById('fCliente').value.trim() || null,
    protocolo: document.getElementById('fProtocolo').value.trim() || null,
    placa: normalizarPlaca(document.getElementById('fPlaca').value),
    duracao_minutos: document.getElementById('fDuracao').value ? Number(document.getElementById('fDuracao').value) : null,
    observacoes: document.getElementById('fObservacoes').value.trim() || null,
    nota_final: Number(notaFinal.toFixed(2)),
  };

  const { data: atendimento, error } = await sb.from('atendimentos').insert(payload).select().single();
  if (error) {
    toast('Erro ao salvar atendimento: ' + error.message, true);
    btn.disabled = false; btn.textContent = 'Salvar avaliação';
    return;
  }

  const avaliacoes = Array.from(rows).map(row => ({
    atendimento_id: atendimento.id,
    criterio_id: row.dataset.criterioId,
    nota: parseFloat(row.querySelector('.criterio-input').value),
  }));
  const { error: errAval } = await sb.from('avaliacoes_criterios').insert(avaliacoes);
  if (errAval) {
    toast('Atendimento salvo, mas houve erro ao salvar as notas dos critérios: ' + errAval.message, true);
  } else {
    toast('Avaliação registrada com sucesso.');
  }

  btn.disabled = false; btn.textContent = 'Salvar avaliação';
  resetFormAtendimento();
  await loadAtendimentos();
  goToView('atendimentos');
}

/* ---------------------------------------------------------
   ATENDIMENTOS — LISTAGEM E FILTROS
--------------------------------------------------------- */
function setupFiltros() {
  ['filtroBusca', 'filtroPlaca', 'filtroColaborador', 'filtroTipo', 'filtroDataIni', 'filtroDataFim'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderAtendimentosTable);
    document.getElementById(id).addEventListener('change', renderAtendimentosTable);
  });
  document.getElementById('btnLimparFiltros').addEventListener('click', () => {
    document.getElementById('filtroBusca').value = '';
    document.getElementById('filtroPlaca').value = '';
    document.getElementById('filtroColaborador').value = '';
    document.getElementById('filtroTipo').value = '';
    document.getElementById('filtroDataIni').value = '';
    document.getElementById('filtroDataFim').value = '';
    renderAtendimentosTable();
  });
  document.getElementById('btnExportarCsvAtendimentos').addEventListener('click', exportarAtendimentosCsv);
}

async function loadAtendimentos() {
  const { data, error } = await sb
    .from('atendimentos')
    .select('*, colaboradores(nome)')
    .order('data_atendimento', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) { toast('Erro ao carregar atendimentos: ' + error.message, true); return; }
  STATE.atendimentos = data || [];
  renderAtendimentosTable();
}

function filtrarAtendimentosAtuais() {
  const busca = document.getElementById('filtroBusca').value.trim().toLowerCase();
  const placaF = document.getElementById('filtroPlaca').value.trim().toUpperCase().replace(/\s+/g, '');
  const colabF = document.getElementById('filtroColaborador').value;
  const tipoF = document.getElementById('filtroTipo').value;
  const dataIni = document.getElementById('filtroDataIni').value;
  const dataFim = document.getElementById('filtroDataFim').value;

  return STATE.atendimentos.filter(a => {
    if (colabF && a.colaborador_id !== colabF) return false;
    if (tipoF && a.tipo_atendimento !== tipoF) return false;
    if (dataIni && a.data_atendimento < dataIni) return false;
    if (dataFim && a.data_atendimento > dataFim) return false;
    if (placaF && !(a.placa || '').toUpperCase().includes(placaF)) return false;
    if (busca) {
      const alvo = [a.cliente, a.protocolo, a.placa, a.colaboradores?.nome, a.avaliador].join(' ').toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function renderAtendimentosTable() {
  const lista = filtrarAtendimentosAtuais();

  const tbody = document.getElementById('tabelaAtendimentos');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum atendimento encontrado para os filtros aplicados.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(a => `
    <tr>
      <td class="mono">${fmtDate(a.data_atendimento)}</td>
      <td>${escapeHtml(a.colaboradores?.nome || '—')}</td>
      <td><span class="pill pill-${a.tipo_atendimento}">${tipoLabel(a.tipo_atendimento)}</span></td>
      <td>${escapeHtml(a.cliente || '–')}${a.protocolo ? `<br><span class="mono" style="font-size:11.5px;color:var(--text-muted)">#${escapeHtml(a.protocolo)}</span>` : ''}</td>
      <td class="mono">${escapeHtml(a.placa || '–')}</td>
      <td>${escapeHtml(a.avaliador)}</td>
      <td>${scoreBadgeHtml(a.nota_final)}</td>
      <td style="text-align:right"><button class="row-link" onclick="abrirDetalhe('${a.id}')">Ver</button></td>
    </tr>
  `).join('');
}

function exportarAtendimentosCsv() {
  const lista = filtrarAtendimentosAtuais();
  if (!lista.length) { toast('Nenhum atendimento para exportar com os filtros atuais.', true); return; }
  const linhas = [['Data', 'Colaborador', 'Tipo', 'Cliente', 'Protocolo', 'Placa', 'Avaliador', 'Nota final', 'Observações']];
  lista.forEach(a => {
    linhas.push([
      fmtDate(a.data_atendimento),
      a.colaboradores?.nome || '',
      tipoLabel(a.tipo_atendimento),
      a.cliente || '',
      a.protocolo || '',
      a.placa || '',
      a.avaliador || '',
      a.nota_final != null ? Number(a.nota_final).toFixed(1) : '',
      (a.observacoes || '').replace(/\r?\n/g, ' '),
    ]);
  });
  const csv = linhas.map(l => l.map(csvEscape).join(';')).join('\r\n');
  baixarArquivo('atendimentos.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8;');
  toast('CSV exportado.');
}
function csvEscape(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function baixarArquivo(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = nome;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------
   DETALHE DO ATENDIMENTO
--------------------------------------------------------- */
let atendimentoDetalheAtual = null;

window.abrirDetalhe = async function (id) {
  const a = STATE.atendimentos.find(x => x.id === id);
  if (!a) return;
  atendimentoDetalheAtual = a;

  document.getElementById('btnEditarAtendimento').classList.remove('hidden');
  document.getElementById('btnSalvarEdicaoAtendimento').classList.add('hidden');
  document.getElementById('detalheScore').textContent = a.nota_final != null ? Number(a.nota_final).toFixed(1) : '–';
  paintRing(document.getElementById('detalheRing'), a.nota_final || 0);

  const { data: avals, error } = await sb
    .from('avaliacoes_criterios')
    .select('*, criterios_avaliacao(nome, peso)')
    .eq('atendimento_id', id);

  let criteriosHtml = '<p style="color:var(--text-muted);font-size:13px">Não foi possível carregar os critérios.</p>';
  if (!error && avals) {
    criteriosHtml = avals.map(v => `
      <div class="detail-criterio">
        <span>${escapeHtml(v.criterios_avaliacao?.nome || 'Critério')} <span class="mono" style="color:var(--text-muted);font-size:11.5px">(peso ${Number(v.criterios_avaliacao?.peso || 1).toFixed(1)})</span></span>
        ${scoreBadgeHtml(v.nota)}
      </div>
    `).join('');
  }
  STATE._detalheCriteriosHtml = criteriosHtml;

  renderDetalheConteudo(a, false);
  openModal('modalDetalhe');
};

function renderDetalheConteudo(a, editMode) {
  const criteriosHtml = STATE._detalheCriteriosHtml || '';
  if (!editMode) {
    document.getElementById('detalheConteudo').innerHTML = `
      <div class="detail-grid">
        <div><span>Colaborador</span>${escapeHtml(a.colaboradores?.nome || '—')}</div>
        <div><span>Avaliador</span>${escapeHtml(a.avaliador)}</div>
        <div><span>Tipo</span>${tipoLabel(a.tipo_atendimento)}</div>
        <div><span>Data</span>${fmtDate(a.data_atendimento)}</div>
        <div><span>Cliente</span>${escapeHtml(a.cliente || '–')}</div>
        <div><span>Protocolo</span>${escapeHtml(a.protocolo || '–')}</div>
        <div><span>Placa</span>${escapeHtml(a.placa || '–')}</div>
        <div><span>Duração</span>${a.duracao_minutos != null ? a.duracao_minutos + ' min' : '–'}</div>
      </div>
      <div class="section-divider" style="margin:18px 0 6px"><span>Critérios</span></div>
      ${criteriosHtml}
      ${a.observacoes ? `<div class="detail-obs">${escapeHtml(a.observacoes)}</div>` : ''}
    `;
  } else {
    document.getElementById('detalheConteudo').innerHTML = `
      <div class="detail-grid">
        <div><span>Colaborador</span>${escapeHtml(a.colaboradores?.nome || '—')}</div>
        <div><span>Avaliador</span>${escapeHtml(a.avaliador)}</div>
        <div><span>Tipo</span>${tipoLabel(a.tipo_atendimento)}</div>
        <div><span>Data</span>${fmtDate(a.data_atendimento)}</div>
        <div class="field"><label>Cliente</label><input type="text" id="edCliente" value="${escapeHtml(a.cliente || '')}"></div>
        <div class="field"><label>Protocolo</label><input type="text" id="edProtocolo" class="mono" value="${escapeHtml(a.protocolo || '')}"></div>
        <div class="field"><label>Placa</label><input type="text" id="edPlaca" class="mono" maxlength="8" value="${escapeHtml(a.placa || '')}"></div>
        <div><span>Duração</span>${a.duracao_minutos != null ? a.duracao_minutos + ' min' : '–'}</div>
      </div>
      <div class="section-divider" style="margin:18px 0 6px"><span>Critérios</span></div>
      ${criteriosHtml}
      <div class="field" style="margin-top:14px"><label>Observações</label><textarea id="edObservacoes" rows="3">${escapeHtml(a.observacoes || '')}</textarea></div>
    `;
  }
}

document.getElementById('btnEditarAtendimento').addEventListener('click', () => {
  if (!atendimentoDetalheAtual) return;
  renderDetalheConteudo(atendimentoDetalheAtual, true);
  document.getElementById('btnEditarAtendimento').classList.add('hidden');
  document.getElementById('btnSalvarEdicaoAtendimento').classList.remove('hidden');
});

document.getElementById('btnSalvarEdicaoAtendimento').addEventListener('click', async () => {
  if (!atendimentoDetalheAtual) return;
  const payload = {
    cliente: document.getElementById('edCliente').value.trim() || null,
    protocolo: document.getElementById('edProtocolo').value.trim() || null,
    placa: normalizarPlaca(document.getElementById('edPlaca').value),
    observacoes: document.getElementById('edObservacoes').value.trim() || null,
  };
  const { error } = await sb.from('atendimentos').update(payload).eq('id', atendimentoDetalheAtual.id);
  if (error) { toast('Erro ao salvar alterações: ' + error.message, true); return; }
  Object.assign(atendimentoDetalheAtual, payload);
  const idx = STATE.atendimentos.findIndex(x => x.id === atendimentoDetalheAtual.id);
  if (idx > -1) Object.assign(STATE.atendimentos[idx], payload);
  toast('Avaliação atualizada.');
  renderDetalheConteudo(atendimentoDetalheAtual, false);
  document.getElementById('btnEditarAtendimento').classList.remove('hidden');
  document.getElementById('btnSalvarEdicaoAtendimento').classList.add('hidden');
  renderAtendimentosTable();
});

document.getElementById('btnExcluirAtendimento').addEventListener('click', async () => {
  if (!atendimentoDetalheAtual) return;
  if (!confirm('Excluir esta avaliação de atendimento? Esta ação não pode ser desfeita.')) return;
  const { error } = await sb.from('atendimentos').delete().eq('id', atendimentoDetalheAtual.id);
  if (error) { toast('Erro ao excluir: ' + error.message, true); return; }
  toast('Avaliação excluída.');
  document.getElementById('modalDetalhe').classList.remove('active');
  await loadAtendimentos();
  await renderDashboard();
});

/* ---------------------------------------------------------
   DASHBOARD
--------------------------------------------------------- */
document.getElementById('dashPeriodo').addEventListener('change', renderDashboard);

async function renderDashboard() {
  const dias = parseInt(document.getElementById('dashPeriodo').value, 10);
  let lista = STATE.atendimentos;
  if (dias > 0) {
    const limite = new Date();
    limite.setDate(limite.getDate() - dias);
    const limiteStr = limite.toISOString().slice(0, 10);
    lista = lista.filter(a => a.data_atendimento >= limiteStr);
  }

  const total = lista.length;
  const media = total ? lista.reduce((s, a) => s + Number(a.nota_final || 0), 0) / total : 0;
  const criticos = lista.filter(a => Number(a.nota_final || 0) < 6).length;
  const chats = lista.filter(a => a.tipo_atendimento === 'chat').length;
  const ligacoes = lista.filter(a => a.tipo_atendimento === 'ligacao').length;

  document.getElementById('kpiMedia').textContent = total ? media.toFixed(1) : '–';
  document.getElementById('kpiMedia').className = 'kpi-value ' + (total && media < 6 ? 'kpi-bad' : '');
  document.getElementById('kpiTotal').textContent = total;
  document.getElementById('kpiCriticos').textContent = criticos;
  document.getElementById('kpiSplit').textContent = total ? `${chats} / ${ligacoes}` : '–';

  renderChartEvolucao(lista);
  await renderChartColaboradores(lista);
  await renderChartCriterios(lista);
}

function destroyChart(key) {
  if (STATE.charts[key]) { STATE.charts[key].destroy(); STATE.charts[key] = null; }
}

function renderChartEvolucao(lista) {
  const porMes = {};
  lista.forEach(a => {
    const mes = a.data_atendimento.slice(0, 7); // YYYY-MM
    if (!porMes[mes]) porMes[mes] = { soma: 0, n: 0 };
    porMes[mes].soma += Number(a.nota_final || 0);
    porMes[mes].n += 1;
  });
  const meses = Object.keys(porMes).sort();
  const medias = meses.map(m => (porMes[m].soma / porMes[m].n).toFixed(2));

  destroyChart('evolucao');
  const ctx = document.getElementById('chartEvolucao');
  STATE.charts.evolucao = new Chart(ctx, {
    type: 'line',
    data: {
      labels: meses.map(formatMesLabel),
      datasets: [{
        label: 'Nota média',
        data: medias,
        borderColor: '#0D9488',
        backgroundColor: 'rgba(13,148,136,0.12)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: '#0D9488',
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 10, ticks: { stepSize: 2 } } }
    }
  });
}

async function renderChartColaboradores(lista) {
  const porColab = {};
  lista.forEach(a => {
    const nome = a.colaboradores?.nome || 'Sem colaborador';
    if (!porColab[nome]) porColab[nome] = { soma: 0, n: 0 };
    porColab[nome].soma += Number(a.nota_final || 0);
    porColab[nome].n += 1;
  });
  const nomes = Object.keys(porColab).sort((a, b) => (porColab[b].soma / porColab[b].n) - (porColab[a].soma / porColab[a].n));
  const medias = nomes.map(n => (porColab[n].soma / porColab[n].n).toFixed(2));
  const cores = medias.map(m => m >= 8 ? '#16A34A' : m >= 6 ? '#D97706' : '#DC2626');

  destroyChart('colaboradores');
  const ctx = document.getElementById('chartColaboradores');
  STATE.charts.colaboradores = new Chart(ctx, {
    type: 'bar',
    data: { labels: nomes, datasets: [{ label: 'Nota média', data: medias, backgroundColor: cores, borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { min: 0, max: 10 } }
    }
  });
}

async function renderChartCriterios(lista) {
  destroyChart('criterios');
  const ctx = document.getElementById('chartCriterios');
  if (!lista.length) {
    STATE.charts.criterios = new Chart(ctx, { type: 'bar', data: { labels: [], datasets: [] } });
    return;
  }
  const ids = lista.map(a => a.id);
  const { data, error } = await sb
    .from('avaliacoes_criterios')
    .select('nota, criterio_id, criterios_avaliacao(nome)')
    .in('atendimento_id', ids);

  if (error || !data) return;

  const porCriterio = {};
  data.forEach(v => {
    const nome = v.criterios_avaliacao?.nome || 'Critério';
    if (!porCriterio[nome]) porCriterio[nome] = { soma: 0, n: 0 };
    porCriterio[nome].soma += Number(v.nota);
    porCriterio[nome].n += 1;
  });
  const nomes = Object.keys(porCriterio);
  const medias = nomes.map(n => (porCriterio[n].soma / porCriterio[n].n).toFixed(2));

  STATE.charts.criterios = new Chart(ctx, {
    type: 'bar',
    data: { labels: nomes, datasets: [{ label: 'Média', data: medias, backgroundColor: '#0D9488', borderRadius: 4 }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 10 } }
    }
  });
}

function formatMesLabel(ym) {
  const [ano, mes] = ym.split('-');
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return nomes[parseInt(mes, 10) - 1] + '/' + ano.slice(2);
}

/* ---------------------------------------------------------
   RELATÓRIO DE DESEMPENHO
--------------------------------------------------------- */
function setupRelatorio() {
  document.getElementById('relSetor').addEventListener('change', renderRelColaboradorSelect);
  document.getElementById('btnGerarRelatorio').addEventListener('click', gerarRelatorio);
  document.getElementById('btnSalvarObservacaoRel').addEventListener('click', salvarObservacaoRelatorio);
  document.getElementById('btnImprimirRelatorio').addEventListener('click', () => window.print());
  document.getElementById('btnExportarExcelRel').addEventListener('click', exportarRelatorioExcel);
  document.getElementById('btnExportarPdfRel').addEventListener('click', exportarRelatorioPdf);
}

async function gerarRelatorio() {
  const colaboradorId = document.getElementById('relColaborador').value;
  if (!colaboradorId) { toast('Selecione um colaborador para gerar o relatório.', true); return; }
  const colaborador = STATE.colaboradores.find(c => c.id === colaboradorId);
  if (!colaborador) return;

  const dataIni = document.getElementById('relDataIni').value;
  const dataFim = document.getElementById('relDataFim').value;

  const btn = document.getElementById('btnGerarRelatorio');
  btn.disabled = true; btn.textContent = 'Gerando...';

  let query = sb.from('atendimentos').select('*, colaboradores(nome, setor, cargo)').eq('colaborador_id', colaboradorId).order('data_atendimento');
  if (dataIni) query = query.gte('data_atendimento', dataIni);
  if (dataFim) query = query.lte('data_atendimento', dataFim);
  const { data: atendimentos, error } = await query;

  if (error) {
    toast('Erro ao gerar relatório: ' + error.message, true);
    btn.disabled = false; btn.textContent = 'Gerar Relatório';
    return;
  }
  if (!atendimentos.length) toast('Nenhum atendimento avaliado para este colaborador no período selecionado.', true);

  // Ranking do colaborador dentro do setor, no mesmo período
  let rankingTexto = '–';
  if (colaborador.setor) {
    const idsColegas = STATE.colaboradores.filter(c => c.setor === colaborador.setor).map(c => c.id);
    let queryColegas = sb.from('atendimentos').select('colaborador_id, nota_final').in('colaborador_id', idsColegas);
    if (dataIni) queryColegas = queryColegas.gte('data_atendimento', dataIni);
    if (dataFim) queryColegas = queryColegas.lte('data_atendimento', dataFim);
    const { data: dadosColegas } = await queryColegas;
    if (dadosColegas && dadosColegas.length) {
      const porColab = {};
      dadosColegas.forEach(d => {
        if (!porColab[d.colaborador_id]) porColab[d.colaborador_id] = { soma: 0, n: 0 };
        porColab[d.colaborador_id].soma += Number(d.nota_final || 0);
        porColab[d.colaborador_id].n += 1;
      });
      const ranking = Object.keys(porColab)
        .map(id => ({ id, media: porColab[id].soma / porColab[id].n }))
        .sort((x, y) => y.media - x.media);
      const posicao = ranking.findIndex(r => r.id === colaboradorId) + 1;
      if (posicao > 0) rankingTexto = `${posicao}º de ${ranking.length}`;
    }
  }

  const notas = atendimentos.map(a => Number(a.nota_final || 0));
  const total = atendimentos.length;
  const media = total ? notas.reduce((s, n) => s + n, 0) / total : 0;
  const melhor = total ? Math.max(...notas) : 0;
  const menor = total ? Math.min(...notas) : 0;
  const periodoTxt = (dataIni || dataFim) ? `${dataIni ? fmtDate(dataIni) : 'início'} a ${dataFim ? fmtDate(dataFim) : 'hoje'}` : 'todo o período';

  document.getElementById('relNomeColaborador').textContent = colaborador.nome;
  document.getElementById('relInfoColaborador').textContent = [colaborador.setor, colaborador.cargo].filter(Boolean).join(' · ') || '–';
  document.getElementById('relMediaGeral').textContent = total ? media.toFixed(1) : '–';
  paintRing(document.getElementById('relRingMedia'), media);
  document.getElementById('relQtd').textContent = total;
  document.getElementById('relMelhor').textContent = total ? melhor.toFixed(1) : '–';
  document.getElementById('relMenor').textContent = total ? menor.toFixed(1) : '–';
  document.getElementById('relSla').textContent = '–';
  document.getElementById('relCsat').textContent = '–';
  document.getElementById('relRanking').textContent = rankingTexto;

  const tbody = document.getElementById('relTabelaAvaliacoes');
  tbody.innerHTML = total ? atendimentos.map(a => `
    <tr>
      <td class="mono">${fmtDate(a.data_atendimento)}</td>
      <td>${escapeHtml(a.cliente || '–')}</td>
      <td class="mono">${escapeHtml(a.placa || '–')}</td>
      <td class="mono">${escapeHtml(a.protocolo || '–')}</td>
      <td><span class="pill pill-${a.tipo_atendimento}">${tipoLabel(a.tipo_atendimento)}</span></td>
      <td>${scoreBadgeHtml(a.nota_final)}</td>
      <td>${escapeHtml(a.avaliador)}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty-row">Nenhuma avaliação no período.</td></tr>';

  // Evolução das notas no período
  const porMes = {};
  atendimentos.forEach(a => {
    const mes = a.data_atendimento.slice(0, 7);
    if (!porMes[mes]) porMes[mes] = { soma: 0, n: 0 };
    porMes[mes].soma += Number(a.nota_final || 0);
    porMes[mes].n += 1;
  });
  const meses = Object.keys(porMes).sort();
  const mediasMes = meses.map(m => (porMes[m].soma / porMes[m].n).toFixed(2));
  destroyChart('relEvolucao');
  STATE.charts.relEvolucao = new Chart(document.getElementById('chartRelEvolucao'), {
    type: 'line',
    data: { labels: meses.map(formatMesLabel), datasets: [{ label: 'Nota média', data: mediasMes, borderColor: '#0D9488', backgroundColor: 'rgba(13,148,136,0.12)', fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: '#0D9488' }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10 } } }
  });

  // Média por critério
  let mediasCriterio = {};
  if (total) {
    const ids = atendimentos.map(a => a.id);
    const { data: avals } = await sb.from('avaliacoes_criterios').select('nota, criterios_avaliacao(nome)').in('atendimento_id', ids);
    (avals || []).forEach(v => {
      const nome = v.criterios_avaliacao?.nome || 'Critério';
      if (!mediasCriterio[nome]) mediasCriterio[nome] = { soma: 0, n: 0 };
      mediasCriterio[nome].soma += Number(v.nota);
      mediasCriterio[nome].n += 1;
    });
  }
  const nomesCrit = Object.keys(mediasCriterio);
  const valoresCrit = nomesCrit.map(n => (mediasCriterio[n].soma / mediasCriterio[n].n).toFixed(2));
  destroyChart('relCriterios');
  STATE.charts.relCriterios = new Chart(document.getElementById('chartRelCriterios'), {
    type: 'bar',
    data: { labels: nomesCrit, datasets: [{ label: 'Média', data: valoresCrit, backgroundColor: '#0D9488', borderRadius: 4 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10 } } }
  });

  // Observação para o Supervisor (carrega a última salva para o colaborador)
  const { data: obs } = await sb.from('relatorio_observacoes').select('*').eq('colaborador_id', colaboradorId).maybeSingle();
  document.getElementById('relObservacao').value = obs?.observacao || '';

  // Cabeçalho de impressão e logo
  document.getElementById('relPrintNomeColab').textContent = colaborador.nome;
  document.getElementById('relPrintMeta').textContent = `${[colaborador.setor, colaborador.cargo].filter(Boolean).join(' · ')} — Período: ${periodoTxt}`;
  const logoImg = document.getElementById('relLogoImg');
  if (STATE.logoUrl) { logoImg.src = STATE.logoUrl; logoImg.classList.remove('hidden'); } else { logoImg.classList.add('hidden'); }

  const agora = new Date();
  const avaliadorEmissor = document.getElementById('fAvaliador').value.trim() || '—';
  document.getElementById('relEmissaoInfo').textContent = `Relatório emitido em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR').slice(0, 5)} por ${avaliadorEmissor}`;

  STATE.relatorioAtual = {
    colaborador, dataIni, dataFim, periodoTxt, atendimentos, avaliadorEmissor,
    media, total, melhor, menor, rankingTexto,
    mediasCriterio: nomesCrit.map((n, i) => ({ nome: n, media: valoresCrit[i] })),
  };

  document.getElementById('relatorioResultado').classList.remove('hidden');
  btn.disabled = false; btn.textContent = 'Gerar Relatório';
}

async function salvarObservacaoRelatorio() {
  if (!STATE.relatorioAtual) { toast('Gere um relatório antes de salvar a observação.', true); return; }
  const texto = document.getElementById('relObservacao').value.trim();
  const payload = {
    colaborador_id: STATE.relatorioAtual.colaborador.id,
    observacao: texto || null,
    autor: document.getElementById('fAvaliador').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('relatorio_observacoes').upsert(payload, { onConflict: 'colaborador_id' });
  if (error) { toast('Erro ao salvar observação: ' + error.message, true); return; }
  toast('Observação salva.');
}

function exportarRelatorioExcel() {
  const r = STATE.relatorioAtual;
  if (!r) { toast('Gere um relatório antes de exportar.', true); return; }
  const wb = XLSX.utils.book_new();

  const resumo = [
    ['Relatório de Desempenho'],
    ['Colaborador', r.colaborador.nome],
    ['Setor', r.colaborador.setor || '–'],
    ['Cargo', r.colaborador.cargo || '–'],
    ['Período analisado', r.periodoTxt],
    [],
    ['Quantidade de avaliações', r.total],
    ['Nota média', r.total ? r.media.toFixed(1) : '–'],
    ['Melhor nota', r.total ? r.melhor.toFixed(1) : '–'],
    ['Menor nota', r.total ? r.menor.toFixed(1) : '–'],
    ['Percentual de SLA cumprido', '–'],
    ['Média do CSAT', '–'],
    ['Ranking no setor', r.rankingTexto],
    [],
    ['Observação para o Supervisor'],
    [document.getElementById('relObservacao').value || '–'],
    [],
    ['Data de emissão', new Date().toLocaleString('pt-BR')],
    ['Avaliador responsável pela emissão', r.avaliadorEmissor],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  wsResumo['!cols'] = [{ wch: 32 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

  const historico = [['Data', 'Cliente', 'Placa', 'Protocolo', 'Tipo', 'Nota final', 'Avaliador']]
    .concat(r.atendimentos.map(a => [
      fmtDate(a.data_atendimento), a.cliente || '', a.placa || '', a.protocolo || '',
      tipoLabel(a.tipo_atendimento), a.nota_final != null ? Number(a.nota_final).toFixed(1) : '', a.avaliador || '',
    ]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(historico), 'Histórico');

  const criteriosSheet = [['Critério', 'Média']].concat(r.mediasCriterio.map(c => [c.nome, c.media]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(criteriosSheet), 'Critérios');

  XLSX.writeFile(wb, `relatorio-${slugify(r.colaborador.nome)}.xlsx`);
  toast('Excel exportado.');
}

function exportarRelatorioPdf() {
  const r = STATE.relatorioAtual;
  if (!r) { toast('Gere um relatório antes de exportar.', true); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 40;
  let y = margin;

  const temLogo = !!STATE.logoUrl;
  if (temLogo) {
    try { doc.addImage(document.getElementById('relLogoImg'), 'PNG', margin, y, 90, 34); } catch (e) { /* logo não carregada */ }
  }
  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text('Relatório de Desempenho', margin + (temLogo ? 100 : 0), y + 20);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text(`${r.colaborador.nome} — ${[r.colaborador.setor, r.colaborador.cargo].filter(Boolean).join(' · ') || '–'}`, margin + (temLogo ? 100 : 0), y + 36);
  y += 60;

  doc.setFontSize(9); doc.setTextColor(100);
  doc.text(`Período analisado: ${r.periodoTxt}`, margin, y); y += 14;
  doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')} por ${r.avaliadorEmissor}`, margin, y);
  doc.setTextColor(0); y += 22;

  doc.autoTable({
    startY: y, margin: { left: margin, right: margin }, theme: 'grid', styles: { fontSize: 9 },
    head: [['Avaliações', 'Nota média', 'Melhor', 'Menor', 'SLA', 'CSAT', 'Ranking no setor']],
    body: [[r.total, r.total ? r.media.toFixed(1) : '–', r.total ? r.melhor.toFixed(1) : '–', r.total ? r.menor.toFixed(1) : '–', '–', '–', r.rankingTexto]],
  });
  y = doc.lastAutoTable.finalY + 20;

  if (r.mediasCriterio.length) {
    doc.setFontSize(11); doc.setFont(undefined, 'bold');
    doc.text('Média por critério', margin, y); y += 8;
    doc.autoTable({
      startY: y + 6, margin: { left: margin, right: margin }, styles: { fontSize: 9 },
      head: [['Critério', 'Média']], body: r.mediasCriterio.map(c => [c.nome, c.media]),
    });
    y = doc.lastAutoTable.finalY + 20;
  }

  [['chartRelEvolucao', 'Evolução das notas'], ['chartRelCriterios', 'Média por critério (gráfico)']].forEach(([id, titulo]) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    if (y > 600) { doc.addPage(); y = margin; }
    doc.setFontSize(11); doc.setFont(undefined, 'bold');
    doc.text(titulo, margin, y); y += 8;
    try { doc.addImage(canvas.toDataURL('image/png', 1.0), 'PNG', margin, y, 250, 120); } catch (e) { /* gráfico vazio */ }
    y += 140;
  });

  if (y > 580) { doc.addPage(); y = margin; }
  doc.setFontSize(11); doc.setFont(undefined, 'bold');
  doc.text('Histórico de avaliações', margin, y); y += 8;
  doc.autoTable({
    startY: y + 6, margin: { left: margin, right: margin }, styles: { fontSize: 8 },
    head: [['Data', 'Cliente', 'Placa', 'Protocolo', 'Tipo', 'Nota', 'Avaliador']],
    body: r.atendimentos.map(a => [fmtDate(a.data_atendimento), a.cliente || '–', a.placa || '–', a.protocolo || '–', tipoLabel(a.tipo_atendimento), a.nota_final != null ? Number(a.nota_final).toFixed(1) : '–', a.avaliador || '']),
  });
  y = doc.lastAutoTable.finalY + 20;

  if (y > 650) { doc.addPage(); y = margin; }
  doc.setFontSize(11); doc.setFont(undefined, 'bold');
  doc.text('Observação para o Supervisor', margin, y); y += 16;
  doc.setFontSize(9); doc.setFont(undefined, 'normal');
  const obsTexto = document.getElementById('relObservacao').value.trim() || '—';
  doc.text(doc.splitTextToSize(obsTexto, 515), margin, y);

  doc.save(`relatorio-${slugify(r.colaborador.nome)}.pdf`);
  toast('PDF exportado.');
}

function slugify(s) {
  return (s || 'relatorio').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
}

/* ---------------------------------------------------------
   UTIL
--------------------------------------------------------- */
// Normaliza a placa para maiúsculas/sem espaço, sem impedir formatos fora do padrão
// Padrão antigo: LLLNNNN | Padrão Mercosul: LLLNLNN
function normalizarPlaca(valor) {
  if (!valor) return null;
  const limpo = valor.trim().toUpperCase().replace(/\s+/g, '');
  return limpo || null;
}
function placaValidaFormatoConhecido(placa) {
  if (!placa) return true;
  const antiga = /^[A-Z]{3}[0-9]{4}$/;
  const mercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
  return antiga.test(placa) || mercosul.test(placa);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
