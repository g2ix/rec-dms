-- Research types and funding sources used by the protocol and by F-27.

CREATE TABLE "research_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "specify" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "research_types_code_key" ON "research_types"("code");

CREATE TABLE "funding_source_kinds" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "detail" TEXT NOT NULL DEFAULT 'NONE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_source_kinds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "funding_source_kinds_code_key" ON "funding_source_kinds"("code");

ALTER TABLE "protocols" ADD COLUMN "research_type_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "research_type_other" TEXT NOT NULL DEFAULT '';

INSERT INTO "research_types" ("id", "code", "label", "sort_order", "specify", "updated_at") VALUES
('9c1a0001-0000-4000-8000-000000000001', 'CLINICAL_SPONSORED', 'Clinical Trial (Sponsored)', 1, false, CURRENT_TIMESTAMP),
('9c1a0001-0000-4000-8000-000000000002', 'SOCIAL_BEHAVIORAL', 'Social / Behavioral Research', 2, false, CURRENT_TIMESTAMP),
('9c1a0001-0000-4000-8000-000000000003', 'STEM_CELL', 'Stem Cell Research', 3, false, CURRENT_TIMESTAMP),
('9c1a0001-0000-4000-8000-000000000004', 'CLINICAL_RESEARCHER', 'Clinical Trials (Researcher-initiated)', 4, false, CURRENT_TIMESTAMP),
('9c1a0001-0000-4000-8000-000000000005', 'PUBLIC_HEALTH', 'Public Health / Epidemiologic Research', 5, false, CURRENT_TIMESTAMP),
('9c1a0001-0000-4000-8000-000000000006', 'GENETIC', 'Genetic Research', 6, false, CURRENT_TIMESTAMP),
('9c1a0001-0000-4000-8000-000000000007', 'HEALTH_OPERATIONS', 'Health Operations Research (Health Programs and Policies)', 7, false, CURRENT_TIMESTAMP),
('9c1a0001-0000-4000-8000-000000000008', 'BIOMEDICAL', 'Biomedical research (Retrospective, Prospective and diagnostic studies)', 8, false, CURRENT_TIMESTAMP),
('9c1a0001-0000-4000-8000-000000000009', 'OTHER', 'Others: please specify', 9, true, CURRENT_TIMESTAMP);

INSERT INTO "funding_source_kinds" ("id", "code", "label", "sort_order", "detail", "updated_at") VALUES
('9c1a0002-0000-4000-8000-000000000001', 'RESEARCHER', 'Researcher-funded', 1, 'NONE', CURRENT_TIMESTAMP),
('9c1a0002-0000-4000-8000-000000000002', 'INSTITUTION', 'Institution-funded', 2, 'INSTITUTION', CURRENT_TIMESTAMP),
('9c1a0002-0000-4000-8000-000000000003', 'AGENCY', 'Agency other than institution', 3, 'AGENCY', CURRENT_TIMESTAMP),
('9c1a0002-0000-4000-8000-000000000004', 'OTHER', 'Others', 4, 'OTHER', CURRENT_TIMESTAMP);
