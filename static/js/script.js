var calendar;
var colaboradorAtualId = '';
var eventosCache = []; 
var historyStack = [];
var redoStack = [];

const Toast = Swal.mixin({
    toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true
});

function registrarAcao(tipo, dados) {
    historyStack.push({ tipo: tipo, dados: dados });
    redoStack = []; 
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
    }).then(() => calendar.refetchEvents());
}

// --- NOVA FUNÇÃO: PERMITE ARRASTAR A TELA (PANNING) ---
function aplicarDragScroll() {
    // Procura o elemento rolavel da timeline no FullCalendar v6
    const ele = document.querySelector('.fc-scrollgrid-section-body .fc-scroller');
    if (!ele) return;

    ele.style.cursor = 'grab';
    ele.style.overflowX = 'auto'; // Garante que a barra existe mas vamos usar o mouse

    let pos = { left: 0, x: 0 };
    let isDown = false;

    ele.addEventListener('mousedown', function(e) {
        // Se clicar num evento ou redimensionador, não ativa o drag da tela
        if(e.target.closest('.fc-event') || e.target.closest('.fc-event-resizer')) return;

        isDown = true;
        ele.style.cursor = 'grabbing';
        ele.style.userSelect = 'none';
        
        pos = {
            left: ele.scrollLeft,
            x: e.clientX,
        };
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDown) return;
        e.preventDefault();
        const dx = e.clientX - pos.x;
        ele.scrollLeft = pos.left - dx;
    });

    document.addEventListener('mouseup', function() {
        if(isDown) {
            isDown = false;
            ele.style.cursor = 'grab';
            ele.style.removeProperty('user-select');
        }
    });
}

document.addEventListener('DOMContentLoaded', function() {
    var calendarEl = document.getElementById('calendar');
    var containerEl = document.getElementById('external-events');

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

        resourceAreaWidth: '200px', 
        slotMinWidth: 40, 
        resourceAreaHeaderContent: 'Equipe',
        
        eventOverlap: true, 
        snapDuration: '24:00:00',
        
        editable: true,
        eventResourceEditable: true,
        eventDurationEditable: true,
        eventStartEditable: true,
        
        resourceLabelContent: function(arg) {
            let props = arg.resource.extendedProps;
            if (props && props.status_texto) {
                return { html: `
                    <div class="d-flex flex-column justify-content-center p-2" style="width: 100%; height: 100%;">
                        <div class="fw-bold text-truncate text-dark" style="font-size: 0.85rem; margin-bottom: 3px;">
                            ${arg.resource.title}
                        </div>
                        <div class="badge ${props.status_classe} text-truncate d-block" style="font-size: 0.65rem; font-weight: normal; padding: 4px;">
                            ${props.status_texto} (${props.dias_trabalhados}d)
                        </div>
                    </div>
                `};
            }
            return { html: arg.resource.title };
        },

        slotLabelContent: function(arg) {
            let dia = arg.date.getDate();
            let semana = arg.date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
            return { html: `<div class='header-dia'>${dia}</div><div class='header-sem'>${semana}</div>` };
        },

        headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
        resources: API_RECURSOS,
        
        events: function(info, successCallback, failureCallback) {
            var folgasOn = document.getElementById('checkFolgas').checked ? '1' : '0';
            var trabOn = document.getElementById('checkTrabalho').checked ? '1' : '0';
            var url = API_EVENTOS + '?folgas=' + folgasOn + '&trabalho=' + trabOn;
            if (colaboradorAtualId) url += '&colaborador_id=' + colaboradorAtualId;

            fetch(url).then(r => r.json()).then(events => {
                eventosCache = events;
                var eventsMapeados = events.map(ev => {
                    let rId = ev.extendedProps ? ev.extendedProps.colaborador_id : null;
                    if (!rId && ev.id.startsWith('trab_')) rId = ev.id.split('_')[1];
                    return { ...ev, resourceId: rId };
                });
                successCallback(eventsMapeados);
            });
        },

        eventContent: function(arg) {
            if (arg.view.type === 'dayGridMonth') return null;
            let tipo = arg.event.extendedProps.tipo_evento;
            let start = arg.event.start;
            let end = arg.event.end || start;
            let diffTime = Math.abs(end - start);
            let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            if (diffDays <= 0) diffDays = 1;

            let htmlContent = `<div class="event-days-container" style="display: grid; grid-template-columns: repeat(${diffDays}, 1fr); width: 100%; height: 100%;">`;
            if (diffDays < 60) {
                for (let i = 1; i <= diffDays; i++) {
                    htmlContent += `<div style="display: flex; align-items: center; justify-content: center; height: 100%;"><span class="day-badge">${i}</span></div>`;
                }
            }
            htmlContent += `</div>`;
            
            let classes = '';
            if (tipo === 'trabalho' && diffDays > 60) classes = 'alerta';
            return { html: `<div class="fc-event-main-frame ${classes}" style="width: 100%; height: 100%;">${htmlContent}</div>` };
        },

        dayCellDidMount: function(info) { renderizarContadorDia(info.date, info.el); },
        droppable: true, selectable: true,
        eventDidMount: function(info) { tippy(info.el, { content: info.event.title, theme: 'light' }); },
        drop: function(info) { if (info.resource) colaboradorAtualId = info.resource.id; },
        
        eventReceive: function(info) {
            var start = info.event.start;
            var resourceId = info.event.getResources()[0] ? info.event.getResources()[0].id : info.event.extendedProps.colaborador_id;
            if(!resourceId && info.event.extendedProps.colaborador_id) resourceId = info.event.extendedProps.colaborador_id;
            var end = new Date(start);
            end.setDate(start.getDate() + 11); 
            var dados = { colaborador_id: resourceId, start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
            salvarEventoSilencioso(dados);
            info.event.remove(); 
        },

        eventClick: function(info) {
            if (info.event.extendedProps.tipo_evento === 'trabalho') {
                Swal.fire('Automático', 'O trabalho se ajusta automaticamente.', 'info');
                return; 
            }
            Swal.fire({
                title: 'Gerenciar Folga', text: "O que deseja fazer?", icon: 'question',
                showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6',
                confirmButtonText: 'Deletar', cancelButtonText: 'Cancelar'
            }).then((result) => {
                if (result.isConfirmed) deletarEvento(info.event.id, true, { 
                    colaborador_id: info.event.extendedProps.colaborador_id,
                    start: info.event.startStr, end: info.event.endStr
                });
            });
        },
        eventResize: function(info) { tratarMovimentoOuResize(info); },
        eventDrop: function(info) { tratarMovimentoOuResize(info); },
        
        // REAPLICA O DRAG SE A VIEW MUDAR
        datesSet: function() {
            if (document.getElementById('containerPrincipal').classList.contains('modo-cheia-layout')) {
                aplicarDragScroll();
            }
        }
    });
    calendar.render();
});

function alternarTelaCheia() {
    var container = document.getElementById('containerPrincipal');
    container.classList.toggle('modo-cheia-layout');
    
    var estaEmTelaCheia = container.classList.contains('modo-cheia-layout');
    var titulo = document.getElementById('tituloCalendario');
    var btn = document.querySelector('.btn-expandir');
    var btnVoltar = document.querySelector('.btn-fechar-cheia');

    var sidebar = document.getElementById('sidebar-equipe');
    var calCol = document.getElementById('calendar-col');

    if (estaEmTelaCheia) {
        titulo.innerText = "Timeline (Tela Cheia)";
        
        sidebar.classList.add('d-none');
        calCol.classList.remove('col-md-9');
        calCol.classList.add('col-12');

        calendar.setOption('height', window.innerHeight - 80); // Altura fixa para o Scroll interno funcionar
        calendar.changeView('resourceTimelineMonth');
        btn.style.display = 'none';
        btnVoltar.style.display = 'inline-block';
        
        // ATIVA O ARRASTAR TELA
        setTimeout(aplicarDragScroll, 500);

    } else {
        titulo.innerText = "Visão Geral";
        
        sidebar.classList.remove('d-none');
        calCol.classList.remove('col-12');
        calCol.classList.add('col-md-9');

        calendar.setOption('height', 'auto');
        calendar.changeView('dayGridMonth');
        btn.style.display = 'inline-block';
        btnVoltar.style.display = 'none';
    }
    setTimeout(() => calendar.updateSize(), 200);
}

// ... Funções auxiliares (filtrarColaborador, etc) mantidas iguais ...
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
    if (id !== '') titulo.innerText = "Visão Individual";
    else titulo.innerText = "Visão Geral";
    calendar.refetchEvents(); 
}
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
        info.revert();
        Swal.fire('Automático', 'O trabalho se ajusta automaticamente.', 'info');
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
    fetch('/api/adicionar_folga', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) })
    .then(r => r.json()).then(d => { if(d.success) { registrarAcao('criar', dados); calendar.refetchEvents(); }});
}
function deletarEvento(id, salvarHistorico, dadosBackup) {
    if(salvarHistorico && dadosBackup) registrarAcao('deletar', { id: id, ...dadosBackup });
    fetch('/api/deletar_evento/' + id, { method: 'DELETE' }).then(r => r.json()).then(d => { if(d.success) calendar.refetchEvents(); });
}
function somarDias(dias) {
    let inicio = document.getElementById('start').value;
    if(inicio) { let data = new Date(inicio); data.setDate(data.getDate() + (dias - 1)); document.getElementById('end').value = data.toISOString().split('T')[0]; }
}
function salvarFolga() {
    const data = { colaborador_id: document.getElementById('colaboradorSelect').value, start: document.getElementById('start').value, end: document.getElementById('end').value };
    if(!data.colaborador_id || !data.start || !data.end) return Swal.fire('Erro', 'Preencha tudo!', 'error');
    salvarEventoSilencioso(data); location.reload(); 
}
function arquivarColaborador(id, nome) {
    event.stopPropagation();
    Swal.fire({ title: 'Arquivar ' + nome + '?', text: "Vai para a lixeira.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Sim' })
    .then((result) => { if (result.isConfirmed) fetch('/api/arquivar_colaborador/' + id, { method: 'POST' }).then(r=>r.json()).then(d=>{if(d.success) location.reload();}); });
}