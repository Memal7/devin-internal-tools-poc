-- CreateTable
CREATE TABLE "kyc_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "dateOfBirth" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedAnalystId" TEXT,
    "assignedAnalystEmail" TEXT,
    "approvalRequestId" TEXT,
    "decisionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_cases_reference_key" ON "kyc_cases"("reference");

-- CreateIndex
CREATE INDEX "kyc_cases_status_createdAt_idx" ON "kyc_cases"("status", "createdAt");

-- CreateIndex
CREATE INDEX "kyc_cases_riskScore_idx" ON "kyc_cases"("riskScore");

-- CreateIndex
CREATE INDEX "kyc_cases_createdAt_idx" ON "kyc_cases"("createdAt");

-- CreateIndex
CREATE INDEX "kyc_cases_assignedAnalystId_idx" ON "kyc_cases"("assignedAnalystId");
