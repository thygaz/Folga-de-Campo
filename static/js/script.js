var calendar;
var colaboradorAtualId = '';
var eventosCache = []; 

// =========================================================
// 1. SISTEMA DE UNDO/REDO (RESTAURADO)
// =========================================================
var historyStack = [];
var redoStack = [];

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true
});

function registrarAcao(tipo, dados) {
    historyStack.push({ tipo: tipo, dados: dados });
    redoStack = []; 
    console.log("Ação registrada:", tipo);
}

document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); executarUndo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); executarRedo(); }
});

function executarUndo() {
    if (historyStack.length === 0) return;
    var acao = historyStack.pop();
    redoStack.push(acao);

    if (acao.tipo === 'criar') {
        Toast.fire({ icon: 'info', title: 'Desfazendo...' });
        setTimeout(() => location.reload(), 500);
    } else if (acao.tipo === 'deletar') {
        recriarEvento(acao.dados);
        Toast.fire({ icon: 'success', title: 'Restaurado.' });
    } else if (acao.tipo === 'mover') {
        atualizarEventoBackend(acao.dados.id, acao.dados.oldStart, acao.dados.oldEnd, acao.dados.tipo, acao.dados.colaborador_id, true);
        Toast.fire({ icon: 'success', title: 'Movimento desfeito.' });
    }
}

function executarRedo() {
    if (redoStack.length === 0) return;
    var acao = redoStack.pop();
    historyStack.push(acao);
    
    if (acao.tipo === 'deletar') deletarEvento(acao.dados.id, false); 
    else if (acao.tipo === 'criar') recriarEvento(acao.dados);
}

function recriarEvento(dados) {
    fetch('/api/adicionar_folga', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
    }).then(() => calendar.refetchEvents());
}

// =========================================================
// 2. CONFIGURAÇÃO PRINCIPAL DO CALENDÁRIO
// =========================================================
document.addEventListener('DOMContentLoaded', function() {
    var calendarEl = document.getElementById('calendar');
    var containerEl = document.getElementById('external-events');

    // Configura Draggable (Arrastar da lateral)
    if (containerEl) {
        new FullCalendar.Draggable(containerEl, {
            itemSelector: '.fc-event-draggable',
            eventData: function(eventEl) {
                return {
                    title: eventEl.getAttribute('data-title'),
                    extendedProps: { colaborador_id: eventEl.getAttribute('data-id') }
                };
            }
        });
    }
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        schedulerLicenseKey: 'CC-Attribution-NonCommercial-NoDerivatives',
        initialView: 'dayGridMonth',
        locale: 'pt-br',
        height: 'auto',

        // --- VISUAL MATRIX (TIMELINE) ---
        resourceAreaWidth: '220px', 
        slotMinWidth: 60,           
        
        // Cabeçalho de Engenharia (Dia Grande / Semana Pequena)
        slotLabelContent: function(arg) {
            let dia = arg.date.getDate();
            let semana = arg.date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
            return { html: `<div class='header-dia'>${dia}</div><div class='header-sem'>${semana}</div>` };
        },

        headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
        
        resources: API_RECURSOS,
        
        // --- CARREGAMENTO DE EVENTOS ---
        events: function(info, successCallback, failureCallback) {
            fetch(API_EVENTOS).then(r => r.json()).then(events => {
                eventosCache = events; // Cache para o contador do modo Mês
                var eventsMapeados = events.map(ev => {
                    // Garante o resourceId para a timeline funcionar
                    let rId = ev.extendedProps ? ev.extendedProps.colaborador_id : null;
                    if (!rId && ev.id.startsWith('trab_')) rId = ev.id.split('_')[1];
                    return { ...ev, resourceId: rId };
                });
                successCallback(eventsMapeados);
            });
        },

        // --- MÁGICA 1: BOLINHAS NA TIMELINE (Visão Expandida) ---
        // Desenha 1, 2, 3... DENTRO da barra colorida
        eventContent: function(arg) {
            // Se estiver na visão mensal, usa o render padrão (para não duplicar bolinhas)
            if (arg.view.type === 'dayGridMonth') return null;

            let tipo = arg.event.extendedProps.tipo_evento;
            let start = arg.event.start;
            let end = arg.event.end || start;
            
            let diffTime = Math.abs(end - start);
            let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            
            if (diffDays > 100) return { domNodes: [] };

            let htmlContent = `<div class="event-days-container">`;
            for (let i = 1; i <= diffDays; i++) {
                htmlContent += `<span class="day-badge" title="Dia ${i}">${i}</span>`;
            }
            htmlContent += `</div>`;
            
            let classes = '';
            if (tipo === 'trabalho' && diffDays > 60) classes = 'alerta';

            return { html: `<div class="fc-event-main-frame ${classes}">${htmlContent}</div>` };
        },

        // --- MÁGICA 2: BOLINHAS NO CALENDÁRIO (Visão Normal) ---
        // Desenha na célula do dia
        dayCellDidMount: function(info) { 
            renderizarContadorDia(info.date, info.el); 
        },

        // --- INTERATIVIDADE ---
        editable: true,
        droppable: true,
        selectable: true,

        eventDidMount: function(info) {
            let texto = info.event.title;
            tippy(info.el, { content: texto, theme: 'light' });
        },

        drop: function(info) { if (info.resource) colaboradorAtualId = info.resource.id; },

        eventReceive: function(info) {
            var start = info.event.start;
            var end = new Date(start);
            end.setDate(start.getDate() + 11); 
            
            var resourceId = info.event.getResources()[0] ? info.event.getResources()[0].id : info.event.extendedProps.colaborador_id;
            if(!resourceId && info.event.extendedProps.colaborador_id) resourceId = info.event.extendedProps.colaborador_id;

            var dados = {
                colaborador_id: resourceId,
                start: start.toISOString().split('T')[0],
                end: end.toISOString().split('T')[0]
            };
            salvarEventoSilencioso(dados);
            info.event.remove(); 
        },

        eventClick: function(info) {
            if (info.event.extendedProps.tipo_evento === 'trabalho') {
                Swal.fire('Info', 'O trabalho preenche os espaços automaticamente.', 'info');
                return;
            }
            Swal.fire({
                title: 'Deletar Folga?', text: "Os dias de trabalho serão recalculados.", icon: 'warning',
                showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Sim'
            }).then((result) => {
                if (result.isConfirmed) deletarEvento(info.event.id, true, { 
                    colaborador_id: info.event.extendedProps.colaborador_id,
                    start: info.event.startStr, end: info.event.endStr
                });
            });
        },
        
        eventResize: function(info) { tratarMovimentoOuResize(info); },
        eventDrop: function(info) { tratarMovimentoOuResize(info); }
    });

    calendar.render();
});

// =========================================================
// 3. FUNÇÕES AUXILIARES
// =========================================================

function alternarTelaCheia() {
    var card = document.querySelector('.card-calendario');
    card.classList.toggle('modo-cheia');
    var estaEmTelaCheia = card.classList.contains('modo-cheia');
    var titulo = document.getElementById('tituloCalendario');

    if (estaEmTelaCheia) {
        titulo.innerText = "Visão Geral (Timeline)";
        calendar.setOption('height', '100%'); 
        calendar.changeView('resourceTimelineMonth');
    } else {
        titulo.innerText = "Visão Geral";
        calendar.setOption('height', 'auto');
        calendar.changeView('dayGridMonth');
    }
    setTimeout(() => calendar.updateSize(), 200);
}

function filtrarColaborador(id, elementoHTML) {
    colaboradorAtualId = id;
    var titulo = document.getElementById('tituloCalendario');
    
    document.querySelectorAll('.list-group-item').forEach(el => el.classList.remove('active', 'bg-light'));
    if(elementoHTML) {
        if(elementoHTML.classList.contains('list-group-item')) elementoHTML.classList.add('active');
        else elementoHTML.closest('.list-group-item').classList.add('active');
    } else {
        document.getElementById('btnVerTodos').classList.add('active');
    }

    if (id !== '') {
        titulo.innerText = "Visão Individual";
        calendar.changeView('dayGridMonth');
        var card = document.querySelector('.card-calendario');
        if(card.classList.contains('modo-cheia')) alternarTelaCheia();
    } else {
        titulo.innerText = "Visão Geral";
    }
    calendar.refetchEvents(); 
}

// Contador para o modo Calendário Normal (Mês)
function renderizarContadorDia(date, element) {
    if (!colaboradorAtualId) return;
    
    var dataCelulalStr = date.toISOString().split('T')[0];
    
    eventosCache.forEach(ev => {
        var inicioStr = ev.start.split('T')[0];
        var fimStr = ev.end.split('T')[0];

        if (dataCelulalStr >= inicioStr && dataCelulalStr < fimStr) {
            var dCel = new Date(dataCelulalStr + 'T00:00:00');
            var dIni = new Date(inicioStr + 'T00:00:00');
            var diffTime = dCel - dIni;
            var diaNumero = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
            
            var badge = document.createElement('div');
            badge.className = 'contador-dia';
            
            var tipo = ev.extendedProps ? ev.extendedProps.tipo_evento : 'folga';

            if (tipo === 'trabalho') {
                badge.classList.add('contador-trabalho');
                badge.innerText = diaNumero; 
                if(diaNumero > 60) {
                     badge.style.backgroundColor = '#dc3545';
                     badge.style.color = 'white';
                     badge.style.borderColor = '#dc3545';
                }
            } else {
                badge.classList.add('contador-folga');
                badge.innerText = diaNumero;
            }
            
            var topElement = element.querySelector('.fc-daygrid-day-top');
            if(topElement) {
                var existing = topElement.querySelector('.contador-dia');
                if(existing) existing.remove();
                topElement.appendChild(badge);
                topElement.style.justifyContent = 'space-between';
            }
        }
    });
}

function tratarMovimentoOuResize(info) {
    if (info.event.extendedProps.tipo_evento === 'trabalho') {
        Swal.fire('Automático', 'O trabalho é automático.', 'warning');
        info.revert();
        return; 
    }
    
    let dados = {
        colaborador_id: info.event.getResources()[0] ? info.event.getResources()[0].id : info.event.extendedProps.colaborador_id,
        start: info.event.startStr,
        end: info.event.endStr || info.event.startStr
    };
    
    registrarAcao('mover', {
        id: info.event.id, oldStart: info.oldEvent.startStr, oldEnd: info.oldEvent.endStr, 
        tipo: 'campo', colaborador_id: dados.colaborador_id
    });

    fetch('/api/deletar_evento/' + info.event.id, { method: 'DELETE' })
    .then(() => { salvarEventoSilencioso(dados); });
}

function salvarEventoSilencioso(dados) {
    fetch('/api/adicionar_folga', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
    }).then(r => r.json()).then(d => {
        if(d.success) {
            registrarAcao('criar', dados);
            calendar.refetchEvents();
        }
    });
}

function deletarEvento(id, salvarHistorico, dadosBackup) {
    if(salvarHistorico && dadosBackup) registrarAcao('deletar', { id: id, ...dadosBackup });
    fetch('/api/deletar_evento/' + id, { method: 'DELETE' }).then(r => r.json()).then(d => { 
        if(d.success) calendar.refetchEvents(); 
    });
}

function getUrlEventos() {
    var mostrarFolgas = document.getElementById('checkFolgas').checked ? '1' : '0';
    var mostrarTrabalho = document.getElementById('checkTrabalho').checked ? '1' : '0';
    var url = '/api/eventos?folgas=' + mostrarFolgas + '&trabalho=' + mostrarTrabalho;
    if (colaboradorAtualId) url += '&colaborador_id=' + colaboradorAtualId;
    return url;
}

function somarDias(dias) {
    let inicio = document.getElementById('start').value;
    if(inicio) {
        let data = new Date(inicio);
        data.setDate(data.getDate() + (dias - 1));
        document.getElementById('end').value = data.toISOString().split('T')[0];
    }
}

function salvarFolga() {
    const data = {
        colaborador_id: document.getElementById('colaboradorSelect').value,
        start: document.getElementById('start').value,
        end: document.getElementById('end').value
    };
    if(!data.colaborador_id || !data.start || !data.end) return Swal.fire('Erro', 'Preencha tudo!', 'error');
    salvarEventoSilencioso(data);
    location.reload(); 
}

function arquivarColaborador(id, nome) {
    event.stopPropagation();
    Swal.fire({
        title: 'Arquivar ' + nome + '?', text: "Vai para a lixeira.", icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Sim'
    }).then((result) => {
        if (result.isConfirmed) fetch('/api/arquivar_colaborador/' + id, { method: 'POST' }).then(r=>r.json()).then(d=>{if(d.success) location.reload();});
    });
}