var calendar;

document.addEventListener('DOMContentLoaded', function() {
    var calendarEl = document.getElementById('calendar');
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        schedulerLicenseKey: 'CC-Attribution-NonCommercial-NoDerivatives',
        initialView: 'resourceTimelineMonth',
        locale: 'pt-br',
        height: '100%',
        timeZone: 'local',
        
        resourceAreaWidth: '200px',
        slotMinWidth: 35, // Largura fixa mínima da coluna no calendário
        resourceAreaHeaderContent: 'Colaborador',
        
        editable: true,
        selectable: true, 
        
        resources: API_RECURSOS,
        events: function(info, successCallback, failureCallback) {
            fetch(API_EVENTOS + '?folgas=1&trabalho=1')
            .then(r => r.json())
            .then(events => {
                successCallback(events.map(ev => {
                    // Trabalho fixo (não arrastável), Folga arrastável
                    let isEditable = ev.extendedProps.tipo_evento !== 'trabalho';
                    return { ...ev, resourceId: String(ev.resourceId), editable: isEditable };
                }));
            });
        },

        // --- RENDERIZAÇÃO DA TABELA ---
        eventContent: function(arg) {
            let tipo = arg.event.extendedProps.tipo_evento;
            let start = arg.event.start;
            let end = arg.event.end || start;
            let diffTime = Math.abs(end - start);
            let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            if (diffDays <= 0) diffDays = 1;

            let classesContainer = 'event-days-table';
            if (tipo === 'trabalho') {
                classesContainer += ' evento-trabalho';
                if(diffDays > 60) classesContainer += ' alerta';
            } else {
                classesContainer += ' evento-folga';
            }

            // AQUI: Cria os divs. O CSS vai colocar as linhas divisórias.
            let htmlContent = `<div class="${classesContainer}">`;
            if (diffDays < 300) {
                for (let i = 1; i <= diffDays; i++) {
                    htmlContent += `<div class="day-cell">${i}</div>`;
                }
            }
            htmlContent += `</div>`;
            return { html: htmlContent };
        },

        // --- CRIAR FOLGA (ARRASTANDO) ---
        select: function(info) {
            if (!info.resource) return;
            var start = new Date(info.startStr);
            var end = new Date(info.endStr);
            var diff = (end - start) / (1000 * 60 * 60 * 24);
            
            if (diff <= 1) { end.setDate(start.getDate() + 11); }

            var dados = {
                colaborador_id: info.resource.id,
                start: start.toISOString().split('T')[0],
                end: end.toISOString().split('T')[0]
            };
            
            fetch('/api/adicionar_folga', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
            }).then(r => r.json()).then(d => { if(d.success) calendar.refetchEvents(); });
            calendar.unselect();
        },

        // --- CLIQUE E GESTÃO ---
        eventClick: function(info) {
            if (info.event.extendedProps.tipo_evento === 'trabalho') {
                Swal.fire({
                    title: 'Lançar Folga Aqui?', 
                    text: "Deseja lançar uma folga iniciando neste dia?", 
                    icon: 'question', 
                    showCancelButton: true, 
                    confirmButtonText: 'Sim'
                }).then((result) => {
                    if (result.isConfirmed) {
                        let start = new Date(info.event.start);
                        let end = new Date(start); end.setDate(start.getDate() + 11);
                        
                        fetch('/api/adicionar_folga', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                colaborador_id: info.event.getResources()[0].id, 
                                start: start.toISOString().split('T')[0], 
                                end: end.toISOString().split('T')[0] 
                            })
                        }).then(r => r.json()).then(d => { if(d.success) calendar.refetchEvents(); });
                    }
                });
            } else {
                Swal.fire({
                    title: 'Deletar Folga?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Deletar'
                }).then((result) => {
                    if (result.isConfirmed) {
                        fetch('/api/deletar_evento/' + info.event.id, { method: 'DELETE' })
                        .then(r => r.json()).then(d => { if(d.success) calendar.refetchEvents(); });
                    }
                });
            }
        },
        eventDrop: function(info) { atualizarFolga(info); },
        eventResize: function(info) { atualizarFolga(info); },
        
        resourceLabelContent: function(arg) {
            let props = arg.resource.extendedProps;
            return { html: `<div class='d-flex flex-column p-1'><span class='fw-bold'>${arg.resource.title}</span><span class='badge ${props.status_classe}' style='font-size:0.6rem'>${props.status_texto} (${props.dias_trabalhados}d)</span></div>` };
        }
    });
    calendar.render();
});

function atualizarFolga(info) {
    let dados = {
        colaborador_id: info.event.getResources()[0].id,
        start: info.event.startStr,
        end: info.event.endStr || info.event.startStr
    };
    fetch('/api/deletar_evento/' + info.event.id, { method: 'DELETE' })
    .then(() => fetch('/api/adicionar_folga', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
    })).then(() => calendar.refetchEvents());
}