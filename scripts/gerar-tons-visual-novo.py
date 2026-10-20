#!/usr/bin/env python3
"""Gera, em src/index.css, as regras que ligam as cores cruas do Tailwind (green-500, red-400...)
às cores de SIGNIFICADO (ok, danger, warn, info, review) quando o visual novo está ligado.

Por quê: o mesmo significado (pago, atrasado, pendente) era escrito com tons e transparências
diferentes em cada tela. Em vez de editar centenas de arquivos, o visual novo religa todas as
variações à mesma cor, que muda por tema (claro/escuro) e sempre lê bem.

Como usar (na raiz do projeto, depois de adicionar ou remover classes de cor):
    python3 -I scripts/gerar-tons-visual-novo.py

O bloco gerado fica entre os marcadores TONS-GERADOS no src/index.css. Não edite à mão.
Depois que o visual novo virar o padrão, a migração definitiva é trocar essas classes no código
por `text-ok-fg`, `bg-ok/10` etc. e apagar este script e o bloco.
"""
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(RAIZ, 'src')
CSS = os.path.join(SRC, 'index.css')
INI = '/* >>> TONS-GERADOS (não edite: rode scripts/gerar-tons-visual-novo.py) */'
FIM = '/* <<< TONS-GERADOS */'

# matiz do Tailwind -> tom de significado. O amarelo fica de fora de propósito: é cor da marca.
TOM = {'green': 'ok', 'emerald': 'ok', 'red': 'danger', 'rose': 'danger',
       'amber': 'warn', 'blue': 'info', 'purple': 'review', 'violet': 'review'}
SOLIDO = {'ok': '#16a34a', 'danger': '#dc2626', 'warn': '#d97706', 'info': '#2563eb', 'review': '#9333ea'}

PADRAO = re.compile(
    r'(?<![\w-])((?:hover:|focus:|group-hover:|active:)?)'
    r'(text|bg|border|ring|outline|fill|stroke|decoration)-'
    r'(green|emerald|red|rose|amber|blue|purple|violet)-(\d{2,3})'
    r'(?:/(\d{1,3}|\[0?\.\d+\]))?(?![\w-])'
)


def escapa(c):
    return re.sub(r'([:/\[\].])', r'\\\1', c)


def pct(a):
    if a is None:
        return None
    if a.startswith('['):
        return round(float(a[1:-1]) * 100)
    return int(a)


def cor(tom, tipo, alfa, shade):
    if tipo in ('text', 'fill', 'stroke', 'decoration'):
        base = f'var(--color-{tom}-fg)'
    elif alfa is None and tipo == 'bg' and shade >= 500:
        base = SOLIDO[tom]
    else:
        base = f'var(--color-{tom})'
    if alfa is None and tipo == 'bg' and shade <= 300:
        alfa = 15  # fundos claros (100-300) viram um véu suave da cor
    if alfa is None:
        return base
    return f'color-mix(in oklab, {base} {alfa}%, transparent)'


def declaracao(tipo, valor):
    if tipo == 'text':
        return f'color: {valor}'
    if tipo == 'bg':
        return f'background-color: {valor}'
    if tipo == 'border':
        return f'border-color: {valor}'
    if tipo == 'ring':
        return f'--tw-ring-color: {valor}'
    if tipo == 'outline':
        return f'outline-color: {valor}'
    if tipo == 'decoration':
        return f'text-decoration-color: {valor}'
    return f'{tipo}: {valor}'  # fill, stroke


def varre():
    achados = {}
    for pasta, _, arquivos in os.walk(SRC):
        for nome in arquivos:
            if not nome.endswith(('.tsx', '.ts')):
                continue
            texto = open(os.path.join(pasta, nome), encoding='utf-8').read()
            for m in PADRAO.finditer(texto):
                achados[m.group(0)] = m.groups()
    return achados


def gera(achados):
    base, hover = [], []
    for classe in sorted(achados):
        pref, tipo, matiz, shade, a = achados[classe]
        tom = TOM[matiz]
        regra_cor = declaracao(tipo, cor(tom, tipo, pct(a), int(shade)))
        sel = escapa(classe)
        if pref == '':
            base.append(f'html.visual-novo .{sel} {{ {regra_cor}; }}')
        elif pref == 'group-hover:':
            hover.append(f'html.visual-novo .group:hover .{sel} {{ {regra_cor}; }}')
        else:
            estado = {'hover:': 'hover', 'focus:': 'focus', 'active:': 'active'}[pref]
            alvo = f'html.visual-novo .{sel}:{estado}'
            (hover if estado == 'hover' else base).append(f'{alvo} {{ {regra_cor}; }}')
    saida = [INI, '/* Gerado a partir das classes de cor cruas usadas no código. */']
    saida += base
    if hover:
        saida.append('@media (hover: hover) {')
        saida += ['  ' + r for r in hover]
        saida.append('}')
    saida.append(FIM)
    return '\n'.join(saida) + '\n'


def aplica(bloco):
    css = open(CSS, encoding='utf-8').read()
    if INI in css:
        css = re.sub(re.escape(INI) + r'.*?' + re.escape(FIM) + r'\n', lambda _: bloco, css, flags=re.S)
    else:
        css = css.rstrip('\n') + '\n\n' + bloco
    open(CSS, 'w', encoding='utf-8').write(css)


if __name__ == '__main__':
    achados = varre()
    bloco = gera(achados)
    if '--dry' in sys.argv:
        print(len(achados), 'classes distintas;', bloco.count('\n'), 'linhas de CSS')
        for tom in sorted(set(TOM.values())):
            n = sum(1 for g in achados.values() if TOM[g[2]] == tom)
            print(' ', tom, n)
    else:
        aplica(bloco)
        print('ok:', len(achados), 'classes mapeadas')
