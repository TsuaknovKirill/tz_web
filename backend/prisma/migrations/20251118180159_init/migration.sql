-- CreateEnum
CREATE TYPE "SpecVersionStatus" AS ENUM ('draft', 'in_review', 'approved', 'published', 'archived');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('start', 'action', 'condition', 'end');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Spec" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "currentVersionId" INTEGER,

    CONSTRAINT "Spec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecVersion" (
    "id" SERIAL NOT NULL,
    "specId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "SpecVersionStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "plainText" TEXT,
    "createdById" INTEGER,
    "basedOnVersionId" INTEGER,

    CONSTRAINT "SpecVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecStep" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "stepKey" TEXT NOT NULL,
    "type" "StepType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "posX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "SpecStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecStepTransition" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "fromStepId" INTEGER NOT NULL,
    "toStepId" INTEGER NOT NULL,
    "label" TEXT,
    "condition" TEXT,
    "metadata" JSONB,

    CONSTRAINT "SpecStepTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Spec_currentVersionId_key" ON "Spec"("currentVersionId");

-- AddForeignKey
ALTER TABLE "Spec" ADD CONSTRAINT "Spec_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Spec" ADD CONSTRAINT "Spec_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "SpecVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecVersion" ADD CONSTRAINT "SpecVersion_specId_fkey" FOREIGN KEY ("specId") REFERENCES "Spec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecVersion" ADD CONSTRAINT "SpecVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecVersion" ADD CONSTRAINT "SpecVersion_basedOnVersionId_fkey" FOREIGN KEY ("basedOnVersionId") REFERENCES "SpecVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecStep" ADD CONSTRAINT "SpecStep_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SpecVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecStepTransition" ADD CONSTRAINT "SpecStepTransition_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SpecVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecStepTransition" ADD CONSTRAINT "SpecStepTransition_fromStepId_fkey" FOREIGN KEY ("fromStepId") REFERENCES "SpecStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecStepTransition" ADD CONSTRAINT "SpecStepTransition_toStepId_fkey" FOREIGN KEY ("toStepId") REFERENCES "SpecStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
