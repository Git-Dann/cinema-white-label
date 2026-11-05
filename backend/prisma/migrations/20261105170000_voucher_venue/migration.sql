-- Vouchers can be limited to one cinema (null = every cinema).
ALTER TABLE "Voucher" ADD COLUMN "venueId" TEXT;
