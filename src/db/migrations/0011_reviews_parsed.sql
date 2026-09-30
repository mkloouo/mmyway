-- A recurring-transaction review waiting for the user's decision is `parsed`, like a receipt
-- waiting for review; `confirmed` means "queued to send" for every other item (#79).
UPDATE `inbox_items` SET `state` = 'parsed' WHERE `kind` = 'recurring_review' AND `state` = 'confirmed';
