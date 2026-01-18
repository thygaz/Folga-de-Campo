// script_index.js
var calendar;
var colaboradorAtualId = '';

document.addEventListener('DOMContentLoaded', function() {
    var calendarEl = document.getElementById('calendar');
    var containerEl = document.getElementById('external-events');

    // Inicializa Drag & Drop da Sidebar
    new FullCalendar.Draggable(containerEl, {
        itemSelector: '.fc-event-draggable',
        eventData: function(eventEl) {
            return {
                title: eventEl.getAttribute('data-title'),
                extendedProps: { colaborador_id: String(eventEl.getAttribute('data-id')) }
            };
        }
    });

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'pt-br',
        height: 'auto',
        headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
        editable: true,
        droppable: true,

        events: function(info, successCallback, failureCallback) {
            var url = API_EVENTOS + '?folgas=1&trabalho=1';
            if (colaboradorAtualId) url += '&colaborador_id=' + colaboradorAtualId;
            fetch(url).then(r => r.json()).then(events => {
                successCallback(events.map(ev => ({ ...ev, resourceId: String(ev.resourceId || ev.extendedProps.colaborador_id) })));
            });
        },

        // Recebe o drop da sidebar
        eventReceive: function(info) {
            var start = info.event.start;
            var resourceId = info.event.extendedProps.colaborador_id;
            var end = new Date(start);
            end.setDate(start.getDate() + 11);
            
            fetch('/api/adicionar_folga', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ colaborador_id: resourceId, start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] })
            }).then(r => r.json()).then(d => { if(d.success) { calendar.refetchEvents(); location.reload(); }}); // Reload para atualizar status sidebar
            info.event.remove();
        },
        
        eventClick: function(info) {
            if (info.event.extendedProps.tipo_evento === 'trabalho') return; // Ignora clique em trabalho na Home
            Swal.fire({
                title: 'Deletar Folga?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Deletar'
            }).then((result) => {
                if (result.isConfirmed) {
                    fetch('/api/deletar_evento/' + info.event.id, { method: 'DELETE' })
                    .then(r => r.json()).then(d => { if(d.success) calendar.refetchEvents(); });
                }
            });
        }
    });
    calendar.render();
});

// Funções globais usadas no HTML
function filtrarColaborador(id) {
    colaboradorAtualId = id;
    calendar.refetchEvents();
}
function arquivarColaborador(id, nome) {
    event.stopPropagation();
    if(confirm('Arquivar ' + nome + '?')) {
        fetch('/api/arquivar_colaborador/' + id, { method: 'POST' }).then(() => location.reload());
    }
}
function somarDias(dias) {
    let inicio = document.getElementById('start').value;
    if(inicio) { let data = new Date(inicio); data.setDate(data.getDate() + (dias - 1)); document.getElementById('end').value = data.toISOString().split('T')[0]; }
}
function salvarFolga() {
    const data = { colaborador_id: document.getElementById('colaboradorSelect').value, start: document.getElementById('start').value, end: document.getElementById('end').value };
    if(!data.colaborador_id || !data.start || !data.end) return alert('Preencha tudo');
    fetch('/api/adicionar_folga', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then(r => r.json()).then(d => { if(d.success) location.reload(); });
}