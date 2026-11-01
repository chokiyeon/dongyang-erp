CREATE TABLE "PayrollReporting" (
 "id" TEXT NOT NULL,
 "employeeId" TEXT NOT NULL,
 "period" TEXT NOT NULL,
 "payrollId" TEXT NOT NULL,
 "basis" TEXT NOT NULL,
 "declaredWage" DECIMAL(20,0) NOT NULL,
 "declaredDays" DECIMAL(5,2) NOT NULL,
 "employerCosts" JSONB NOT NULL,
 "sourceReference" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 0,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PayrollReporting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollReporting_employeeId_period_key" ON "PayrollReporting"("employeeId","period");
ALTER TABLE "PayrollReporting" ADD CONSTRAINT "PayrollReporting_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
