from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta, date
import pytz  # <--- NOVA IMPORTAÇÃO NECESSÁRIA

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///pipeline_folgas.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# ==============================================================================
# CONFIGURAÇÃO DE FUSO HORÁRIO (BRASÍLIA)
# ==============================================================================

# Define o fuso horário oficial
FUSO_BR = pytz.timezone('America/Sao_Paulo')

def get_hoje():
    """
    Retorna a data atual respeitando o fuso horário de Brasília/SP.
    Substitui o date.today() para evitar erros em servidores UTC (nuvem).
    """
    return datetime.now(FUSO_BR).date()

# ==============================================================================
# 1. MODELOS
# ==============================================================================

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

# ==============================================================================
# 2. LÓGICA DE NEGÓCIO
# ==============================================================================

def calcular_status(colab):
    if not colab.ativo: return {"texto": "Arquivado", "classe": "bg-secondary", "dias_trabalhados": 0}
    if not colab.ultima_folga_fim: return {"t\\exto": "Definir (Lance a última folga)", "classe": "bg-secondary", "dias_trabalhados": 0}
    
    # ALTERADO: Usa get_hoje() ao invés de date.today()
    hoje = get_hoje()
    
    dias_trabalhados = (hoje - colab.ultima_folga_fim).days
    if dias_trabalhados < 0: dias_trabalhados = 0 

    if dias_trabalhados >= 60: return {"texto": "Folga de Campo Vencida", "classe": "bg-danger", "dias_trabalhados": dias_trabalhados}
    elif dias_trabalhados >= 40: return {"texto": "Próximo ao Vencimento", "classe": "bg-warning text-dark", "dias_trabalhados": dias_trabalhados}
    else: return {"texto": "Em ciclo de trabalho", "classe": "bg-success", "dias_trabalhados": dias_trabalhados}

def verificar_ciclos():
    # Atualiza automaticamente o ciclo se uma folga programada acabou de acontecer
    # ALTERADO: Usa get_hoje() ao invés de date.today()
    hoje = get_hoje()
    
    folgas_passadas = Folga.query.filter(Folga.end < hoje).all()
    mudou = False
    for f in folgas_passadas:
        if not f.colaborador.ultima_folga_fim or f.end > f.colaborador.ultima_folga_fim:
            f.colaborador.ultima_folga_fim = f.end
            mudou = True
    if mudou: db.session.commit()

# ==============================================================================
# 3. ROTAS
# ==============================================================================

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

@app.route('/arquivados')
def arquivados():
    ex = Colaborador.query.filter_by(ativo=False).order_by(Colaborador.nome).all()
    return render_template('arquivados.html', colaboradores=ex)

@app.route('/api/recursos')
def get_recursos():
    colaboradores = Colaborador.query.filter_by(ativo=True).order_by(Colaborador.nome).all()
    return jsonify([{'id': c.id, 'title': c.nome.split()[0], 'eventColor': '#3788d8'} for c in colaboradores])

@app.route('/api/eventos')
def get_eventos():
    colab_id = request.args.get('colaborador_id')
    mostrar_folgas = request.args.get('folgas', '1') == '1'
    mostrar_trabalho = request.args.get('trabalho', '1') == '1'

    eventos = []
    folgas_futuras = {} 
    
    # ALTERADO: Usa get_hoje() ao invés de date.today()
    hoje = get_hoje()
    
    # 1. FOLGAS
    if mostrar_folgas:
        query = Folga.query.join(Colaborador).filter(Colaborador.ativo == True)
        if colab_id: query = query.filter(Folga.colaborador_id == colab_id)
        folgas = query.all()

        for f in folgas:
            # Verde se é hoje ou passado, Azul se é futuro
            cor = '#198754' if f.start <= hoje else '#0d6efd'
            tipo_desc = 'Realizada' if f.start <= hoje else 'Programada'
            
            if f.colaborador_id not in folgas_futuras: folgas_futuras[f.colaborador_id] = []
            folgas_futuras[f.colaborador_id].append(f.start)

            eventos.append({
                'id': f.id, 'resourceId': f.colaborador_id,
                'title': f"FOLGA ({tipo_desc})", 'start': f.start.isoformat(),
                'end': (f.end + timedelta(days=1)).isoformat(), 'color': cor,
                'extendedProps': {'colaborador_id': f.colaborador_id, 'tipo_evento': 'folga'},
                'display': 'block'
            })

    # 2. TRABALHO (Automático)
    if mostrar_trabalho:
        query = Colaborador.query.filter_by(ativo=True)
        if colab_id: query = query.filter_by(id=colab_id)
        colabs = query.all()
        
        for c in colabs:
            if c.ultima_folga_fim:
                start_work = c.ultima_folga_fim + timedelta(days=1)
                
                # Acha a próxima folga para cortar o trabalho
                proxima_folga = None
                if c.id in folgas_futuras:
                    datas_futuras = [d for d in folgas_futuras[c.id] if d > start_work]
                    if datas_futuras: proxima_folga = min(datas_futuras)
                
                if proxima_folga:
                    end_work = proxima_folga - timedelta(days=1)
                else:
                    dias_corridos = (hoje - start_work).days
                    projecao = max(60, dias_corridos + 10)
                    end_work = start_work + timedelta(days=projecao)
                
                if end_work >= start_work:
                    duracao = (end_work - start_work).days + 1
                    bg = '#f8f9fa'
                    txt = '#495057'
                    bd = '#dee2e6'
                    
                    if duracao > 60:
                        bg = '#ffebee'
                        txt = '#c62828'
                        bd = '#ef9a9a'

                    eventos.append({
                        'id': f"trab_{c.id}", 'resourceId': c.id,
                        'title': "TRABALHO", 'start': start_work.isoformat(),
                        'end': (end_work + timedelta(days=1)).isoformat(),
                        'backgroundColor': bg, 'borderColor': bd, 'textColor': txt,
                        'extendedProps': {'tipo_evento': 'trabalho'},
                        'display': 'block' 
                    })

    return jsonify(eventos)

@app.route('/api/adicionar_folga', methods=['POST'])
def adicionar_folga():
    data = request.json
    d_inicio = datetime.strptime(data['start'], '%Y-%m-%d').date()
    d_fim = datetime.strptime(data['end'], '%Y-%m-%d').date()
    
    # Salva folga (o tipo visual é decidido na leitura)
    nova = Folga(colaborador_id=data['colaborador_id'], start=d_inicio, end=d_fim, tipo='campo')
    
    # Se for folga passada ou hoje, atualiza ciclo
    colab = Colaborador.query.get(data['colaborador_id'])
    
    # ALTERADO: Usa get_hoje() ao invés de date.today()
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
    return redirect(url_for('index'))

@app.route('/api/deletar_evento/<int:id>', methods=['DELETE'])
def deletar_evento(id):
    folga = Folga.query.get_or_404(id)
    db.session.delete(folga)
    db.session.commit()
    return jsonify({'success': True})

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5020)