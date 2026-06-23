-- Agrega la columna consumed_snapshot a production_batches para guardar un
-- snapshot de los ingredientes consumidos al momento del start, de modo que
-- un cancel posterior pueda revertir exactamente lo que se consumió aunque
-- la receta haya sido editada entre el start y el cancel.
ALTER TABLE production_batches ADD COLUMN consumed_snapshot TEXT;
