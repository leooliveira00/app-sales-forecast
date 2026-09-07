-- Perfil somente-leitura: acompanha dashboard, consolidado e aprovações sem
-- alterar nada. Criado para controladoria/diretoria, que até aqui dependiam de
-- perfis administrativos (operador_pcp / admin_ti) apenas para visualizar —
-- expostos, portanto, a alterar configuração e parâmetros por engano.
--
-- ADD VALUE é aditivo e não reescreve dados: os perfis existentes seguem intactos.
ALTER TYPE "Perfil" ADD VALUE IF NOT EXISTS 'consulta';
