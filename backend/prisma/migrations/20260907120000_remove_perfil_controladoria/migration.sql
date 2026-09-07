-- Remove o perfil "controladoria": quem aprova/rejeita submissões passa a ser
-- exclusivamente o PCP (operador_pcp/admin_ti). Controladoria e demais áreas
-- interessadas passam a usar o perfil "consulta" (somente leitura), já existente,
-- para visualizar e extrair dados.

-- Reatribui usuários existentes com o perfil descontinuado antes de remover o valor do enum.
UPDATE "User" SET "perfil" = 'consulta' WHERE "perfil" = 'controladoria';

-- AlterEnum: Postgres não suporta DROP VALUE diretamente — recria o tipo sem "controladoria".
CREATE TYPE "Perfil_new" AS ENUM ('gestor', 'operador_pcp', 'admin_ti', 'consulta');
ALTER TABLE "User" ALTER COLUMN "perfil" TYPE "Perfil_new" USING ("perfil"::text::"Perfil_new");
ALTER TYPE "Perfil" RENAME TO "Perfil_old";
ALTER TYPE "Perfil_new" RENAME TO "Perfil";
DROP TYPE "Perfil_old";
