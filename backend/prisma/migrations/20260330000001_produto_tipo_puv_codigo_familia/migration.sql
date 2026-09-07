-- Novo campo tipo em Produto (ex: "PA", "PI", "MP" — tipo do produto no ERP Protheus)
ALTER TABLE "Produto"
  ADD COLUMN IF NOT EXISTS "tipo" TEXT;

-- Novo campo codigoFamilia em ProdutoUnidadeVenda (codigoFamiliaAGM do Protheus)
ALTER TABLE "ProdutoUnidadeVenda"
  ADD COLUMN IF NOT EXISTS "codigoFamilia" TEXT;
