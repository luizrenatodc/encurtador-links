"""Junta os quadros gravados por telas.mjs em docs/uso.gif (duração de cada quadro em duracoes.json).
Uso: python scripts/montar_gif.py [largura]   (requer Pillow)"""
import json
import sys
from pathlib import Path

from PIL import Image

largura = int(sys.argv[1]) if len(sys.argv) > 1 else 800
pasta = Path("tmp/quadros")
duracoes = json.loads((pasta / "duracoes.json").read_text())
quadros = []
for i in range(len(duracoes)):
    img = Image.open(pasta / f"f{i:04d}.png").convert("RGB")
    quadros.append(img.resize((largura, img.height * largura // img.width), Image.LANCZOS))
paleta = [q.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for q in quadros]
saida = Path("docs/uso.gif")
paleta[0].save(saida, save_all=True, append_images=paleta[1:], duration=duracoes, loop=0, optimize=True, disposal=1)
print(len(quadros), "quadros,", round(sum(duracoes) / 1000, 1), "s,", round(saida.stat().st_size / 1e6, 2), "MB")
