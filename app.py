from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta, date
import pytz 

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///pipeline_folgas.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Configuração de Fuso Horário
FUSO_BR = pytz.timezone('America/Sao_Paulo')

def get_hoje():
    return datetime.now(FUSO_BR).date()

# --- MODELOS DO BANCO DE DADOS ---
class Colaborador(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(100), nullable=False)
    cargo = db.Column(db.String(50))
    ativo = db.Column(db.Boolean, default=True)
    ultima_folga_fim = db.Column(db.Date, nullable=True) 

class Folga(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    colaborador_id = db.Column(db.Integer, db.ForeignKey('colaborador.id'), nullable=False)
    start = db.Column(db.Date, nullable=False)
    end = db.Column(db.Date, nullable=False)
    tipo = db.Column(db.String(20), default='campo') 
    colaborador = db.relationship('Colaborador', backref=db.backref('folgas', lazy=True))

# --- LÓGICA DE NEGÓCIO ---
def calcular_status(colab):
    if not colab.ativo: return {"texto": "Arquivado", "classe": "bg-secondary", "dias_trabalhados": 0}
    if not colab.ultima_folga_fim: return {"texto": "A definir", "classe": "bg-secondary", "dias_trabalhados": 0}
    
    hoje = get_hoje()
    dias_trabalhados = (hoje - colab.ultima_folga_fim).days
    if dias_trabalhados < 0: dias_trabalhados = 0 

    if dias_trabalhados >= 60: return {"texto": "Vencida", "classe": "bg-danger", "dias_trabalhados": dias_trabalhados}
    elif dias_trabalhados >= 40: return {"texto": "Atenção", "classe": "bg-warning text-dark", "dias_trabalhados": dias_trabalhados}
    else: return {"texto": "Em ciclo", "classe": "bg-success", "dias_trabalhados": dias_trabalhados}

def verificar_ciclos():
    # Atualiza automaticamente a 'última folga' baseada no histórico
    hoje = get_hoje()
    folgas_passadas = Folga.query.filter(Folga.end < hoje).all()
    mudou = False
    for f in folgas_passadas:
        if not f.colaborador.ultima_folga_fim or f.end > f.colaborador.ultima_folga_fim:
            f.colaborador.ultima_folga_fim = f.end
            mudou = True
    if mudou: db.session.commit()

# --- ROTAS DE PÁGINAS (FRONTEND) ---
@app.route('/')
def index():
    verificar_ciclos() 
    colaboradores = Colaborador.query.filter_by(ativo=True).order_by(Colaborador.nome).all()
    dados_tabela = []
    for c in colaboradores:
        status = calcular_status(c)
        dados_tabela.append({
            'id': c.id, 'nome': c.nome, 'status': status['texto'],
            'classe': status['classe'], 'dias': status['dias_trabalhados'],
            'ultima_folga': c.ultima_folga_fim.strftime('%d/%m/%Y') if c.ultima_folga_fim else "-"
        })
    return render_template('index.html', colaboradores=colaboradores, dados=dados_tabela)

@app.route('/timeline')
def timeline():
    # Rota específica para a tela cheia (Timeline)
    colaboradores = Colaborador.query.filter_by(ativo=True).order_by(Colaborador.nome).all()
    return render_template('timeline.html', colaboradores=colaboradores)

@app.route('/arquivados')
def arquivados():
    ex = Colaborador.query.filter_by(ativo=False).order_by(Colaborador.nome).all()
    return render_template('arquivados.html', colaboradores=ex)

# --- API (JSON PARA O FULLCALENDAR) ---
@app.route('/api/recursos')
def get_recursos():
    colaboradores = Colaborador.query.filter_by(ativo=True).order_by(Colaborador.nome).all()
    lista = []
    for c in colaboradores:
        st = calcular_status(c)
        lista.append({
            'id': str(c.id), 
            'title': c.nome, 
            'status_texto': st['texto'],
            'status_classe': st['classe'],
            'dias_trabalhados': st['dias_trabalhados']
        })
    return jsonify(lista)

@app.route('/api/eventos')
def get_eventos():
    colab_id = request.args.get('colaborador_id')
    mostrar_folgas = request.args.get('folgas', '1') == '1'
    mostrar_trabalho = request.args.get('trabalho', '1') == '1'
    hoje = get_hoje()

    eventos = []
    folgas_futuras = {} 
    
    # 1. RECUPERA FOLGAS
    if mostrar_folgas:
        query = Folga.query.join(Colaborador).filter(Colaborador.ativo == True)
        if colab_id: query = query.filter(Folga.colaborador_id == colab_id)
        folgas = query.all()

        for f in folgas:
            cor = '#198754' if f.start <= hoje else '#0d6efd'
            tipo_desc = 'Realizada' if f.start <= hoje else 'Programada'
            
            # Armazena para cálculo de trabalho
            if f.colaborador_id not in folgas_futuras: folgas_futuras[f.colaborador_id] = []
            folgas_futuras[f.colaborador_id].append(f.start)

            eventos.append({
                'id': str(f.id), 
                'resourceId': str(f.colaborador_id),
                'title': f"FOLGA ({tipo_desc})", 
                'start': f.start.isoformat(),
                'end': (f.end + timedelta(days=1)).isoformat(), 
                'color': cor,
                'extendedProps': {'colaborador_id': f.colaborador_id, 'tipo_evento': 'folga'},
                'display': 'block'
            })

    # 2. CALCULA E PROJETA TRABALHO
    if mostrar_trabalho:
        query = Colaborador.query.filter_by(ativo=True)
        if colab_id: query = query.filter_by(id=colab_id)
        colabs = query.all()
        
        for c in colabs:
            if c.ultima_folga_fim:
                start_work = c.ultima_folga_fim + timedelta(days=1)
                
                # Verifica se existe uma folga futura que "corta" o período de trabalho
                proxima_folga = None
                if c.id in folgas_futuras:
                    datas_futuras = [d for d in folgas_futuras[c.id] if d > start_work]
                    if datas_futuras: proxima_folga = min(datas_futuras)
                
                if proxima_folga:
                    end_work = proxima_folga - timedelta(days=1)
                else:
                    # PROJEÇÃO PADRÃO: 60 DIAS (1 + 59)
                    end_work = start_work + timedelta(days=59) 
                
                # Apenas renderiza se a data final for válida
                if end_work >= start_work:
                    duracao = (end_work - start_work).days + 1
                    
                    # Definição de cores
                    bg, txt, bd = '#f8f9fa', '#495057', '#dee2e6'
                    
                    # Se a duração REAL exceder 60 dias (ex: folga muito longe), marca vermelho
                    if duracao > 60: 
                        bg, txt, bd = '#ffebee', '#c62828', '#ef9a9a'

                    eventos.append({
                        'id': f"trab_{c.id}", 
                        'resourceId': str(c.id),
                        'title': "TRABALHO", 
                        'start': start_work.isoformat(),
                        'end': (end_work + timedelta(days=1)).isoformat(),
                        'backgroundColor': bg, 
                        'borderColor': bd, 
                        'textColor': txt,
                        'extendedProps': {'tipo_evento': 'trabalho', 'colaborador_id': c.id}, 
                        'display': 'block' 
                    })
    return jsonify(eventos)

# --- AÇÕES DE ESCRITA ---
@app.route('/api/adicionar_folga', methods=['POST'])
def adicionar_folga():
    data = request.json
    d_inicio = datetime.strptime(data['start'], '%Y-%m-%d').date()
    d_fim = datetime.strptime(data['end'], '%Y-%m-%d').date()
    
    nova = Folga(colaborador_id=data['colaborador_id'], start=d_inicio, end=d_fim, tipo='campo')
    
    # Atualiza status do colaborador se a folga for passada/presente
    colab = Colaborador.query.get(data['colaborador_id'])
    if d_inicio <= get_hoje():
        if not colab.ultima_folga_fim or d_fim > colab.ultima_folga_fim: 
            colab.ultima_folga_fim = d_fim
            
    db.session.add(nova)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/arquivar_colaborador/<int:id>', methods=['POST'])
def arquivar_colaborador(id):
    c = Colaborador.query.get_or_404(id)
    c.ativo = False
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/restaurar_colaborador/<int:id>', methods=['POST'])
def restaurar_colaborador(id):
    c = Colaborador.query.get_or_404(id)
    c.ativo = True
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/novo_colaborador', methods=['POST'])
def novo_colaborador():
    nome = request.form.get('nome')
    if nome:
        db.session.add(Colaborador(nome=nome.upper(), ativo=True))
        db.session.commit()
    # Redireciona para a página de onde veio (Index ou Timeline)
    return redirect(request.referrer or url_for('index'))

@app.route('/api/deletar_evento/<str_id>', methods=['DELETE']) 
def deletar_evento(str_id):
    # Proteção: Se tentar deletar um evento "trab_X", apenas retorna sucesso (frontend já bloqueia, mas backend garante)
    if 'trab_' in str(str_id): 
        return jsonify({'success': True})
    
    folga = Folga.query.get(str_id)
    if folga:
        db.session.delete(folga)
        db.session.commit()
    return jsonify({'success': True})

if __name__ == '__main__':
    with app.app_context(): 
        db.create_all()
    app.run(debug=True, port=5020)