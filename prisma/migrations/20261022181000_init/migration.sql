-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('ADMIN', 'SALES_EXECUTIVE', 'AGM', 'DGM_GM', 'VP_SALES', 'SALES_COORDINATOR', 'MIS', 'DIRECTOR', 'CRM');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('VILLA', 'PLOT', 'APARTMENT');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CHQ', 'CARD', 'ONLINE');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('OWN_FUNDS', 'HOME_LOAN');

-- CreateEnum
CREATE TYPE "ApplicantType" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "Salutation" AS ENUM ('MR', 'MRS', 'MS');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('SON_OF', 'DAUGHTER_OF', 'WIFE_OF');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('COMMUNICATION', 'PERMANENT');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'RETURNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepAction" AS ENUM ('SIGN', 'VALIDATE_AND_SIGN');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('LOCKED', 'PENDING', 'SIGNED', 'VALIDATED', 'RETURNED', 'SKIPPED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "DocumentScope" AS ENUM ('FORM', 'APPLICANT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'EDIT', 'UPLOAD', 'VIEW_SENSITIVE', 'SIGN', 'VALIDATE', 'RETURN', 'REASSIGN', 'SUBMIT', 'CANCEL', 'PDF', 'EXPORT', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_RESET', 'SYNC');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" "RoleName" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_code" TEXT,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_options" (
    "id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "flow_template_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_steps" (
    "id" UUID NOT NULL,
    "flow_template_id" UUID NOT NULL,
    "order_index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "action" "StepAction" NOT NULL DEFAULT 'SIGN',
    "skip_if_no_second_applicant" BOOLEAN NOT NULL DEFAULT false,
    "acts_on_creator_device" BOOLEAN NOT NULL DEFAULT false,
    "pdf_signature_slot" TEXT NOT NULL,

    CONSTRAINT "flow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "help_text" TEXT,
    "scope" "DocumentScope" NOT NULL,
    "applies_to" "ApplicantType",
    "accepted_mime_types" TEXT[],
    "max_bytes" INTEGER NOT NULL DEFAULT 10485760,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requirements" (
    "id" UUID NOT NULL,
    "document_type_id" UUID NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "required_if_second_applicant" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tnc_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "body_sha256" TEXT NOT NULL,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tnc_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_forms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "form_template_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "booking_id" TEXT,
    "booking_date" DATE NOT NULL,
    "project_id" UUID,
    "property_type" "PropertyType",
    "apartment_no" TEXT,
    "sales_executive" TEXT,
    "sales_head" TEXT,
    "telecaller" TEXT,
    "lead_id" TEXT,
    "source" TEXT,
    "built_up_area_sqft" DECIMAL(10,2),
    "uds_sqft" DECIMAL(10,2),
    "floor" TEXT,
    "booking_advance_paise" BIGINT,
    "payment_mode" "PaymentMode",
    "payment_ref_no" TEXT,
    "payment_date" DATE,
    "bank" TEXT,
    "payment_source" "PaymentSource",
    "sale_price_paise" BIGINT,
    "remarks" TEXT,
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "current_step_order" INTEGER,
    "return_to_step_order" INTEGER,
    "tnc_version_id" UUID,
    "tnc_accepted_at" TIMESTAMPTZ,
    "submitted_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "booking_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicants" (
    "id" UUID NOT NULL,
    "booking_form_id" UUID NOT NULL,
    "applicant_type" "ApplicantType" NOT NULL,
    "salutation" "Salutation",
    "full_name" TEXT,
    "relation_type" "RelationType",
    "guardian_salutation" "Salutation",
    "guardian_name" TEXT,
    "mobile_no" TEXT,
    "alt_mobile_no" TEXT,
    "email" TEXT,
    "pan_encrypted" BYTEA,
    "pan_last4" TEXT,
    "aadhaar_encrypted" BYTEA,
    "aadhaar_last4" TEXT,
    "dob" DATE,
    "occupation" TEXT,
    "company_name" TEXT,
    "designation" TEXT,
    "location" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "booking_form_id" UUID NOT NULL,
    "type" "AddressType" NOT NULL,
    "line1" TEXT,
    "line2" TEXT,
    "line3" TEXT,
    "line4" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_documents" (
    "id" UUID NOT NULL,
    "booking_form_id" UUID NOT NULL,
    "document_type_id" UUID NOT NULL,
    "applicant_id" UUID,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_flow_instances" (
    "id" UUID NOT NULL,
    "booking_form_id" UUID NOT NULL,
    "flow_template_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "form_flow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_step_records" (
    "id" UUID NOT NULL,
    "form_flow_instance_id" UUID NOT NULL,
    "flow_step_id" UUID NOT NULL,
    "order_index" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'LOCKED',
    "assignee_id" UUID,
    "witness_user_id" UUID,
    "signature_asset_id" UUID,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "acted_at" TIMESTAMPTZ,
    "ip" TEXT,
    "device" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "form_step_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_assets" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'image/png',
    "width_px" INTEGER,
    "height_px" INTEGER,
    "sha256" TEXT,
    "signed_by_user_id" UUID,
    "signer_name" TEXT,
    "captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_pdfs" (
    "id" UUID NOT NULL,
    "booking_form_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_pdfs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "booking_form_id" UUID,
    "user_id" UUID,
    "action" "AuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "detail" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMPTZ,
    "email_sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_mirror_jobs" (
    "id" UUID NOT NULL,
    "booking_form_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "succeeded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sheet_mirror_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "booking_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "projects_organization_id_is_active_idx" ON "projects"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_external_code_key" ON "projects"("organization_id", "external_code");

-- CreateIndex
CREATE UNIQUE INDEX "source_options_value_key" ON "source_options"("value");

-- CreateIndex
CREATE UNIQUE INDEX "form_templates_flow_template_id_key" ON "form_templates"("flow_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_templates_organization_id_key_key" ON "form_templates"("organization_id", "key");

-- CreateIndex
CREATE INDEX "flow_steps_role_id_idx" ON "flow_steps"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "flow_steps_flow_template_id_order_index_key" ON "flow_steps"("flow_template_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_organization_id_key_key" ON "document_types"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "document_requirements_document_type_id_key" ON "document_requirements"("document_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "tnc_versions_organization_id_version_key" ON "tnc_versions"("organization_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "booking_forms_booking_id_key" ON "booking_forms"("booking_id");

-- CreateIndex
CREATE INDEX "booking_forms_organization_id_status_idx" ON "booking_forms"("organization_id", "status");

-- CreateIndex
CREATE INDEX "booking_forms_created_by_id_idx" ON "booking_forms"("created_by_id");

-- CreateIndex
CREATE INDEX "booking_forms_project_id_idx" ON "booking_forms"("project_id");

-- CreateIndex
CREATE INDEX "booking_forms_lead_id_idx" ON "booking_forms"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "applicants_booking_form_id_applicant_type_key" ON "applicants"("booking_form_id", "applicant_type");

-- CreateIndex
CREATE UNIQUE INDEX "addresses_booking_form_id_type_key" ON "addresses"("booking_form_id", "type");

-- CreateIndex
CREATE INDEX "form_documents_booking_form_id_idx" ON "form_documents"("booking_form_id");

-- CreateIndex
CREATE INDEX "form_documents_document_type_id_idx" ON "form_documents"("document_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_flow_instances_booking_form_id_key" ON "form_flow_instances"("booking_form_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_step_records_signature_asset_id_key" ON "form_step_records"("signature_asset_id");

-- CreateIndex
CREATE INDEX "form_step_records_assignee_id_status_idx" ON "form_step_records"("assignee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "form_step_records_form_flow_instance_id_order_index_key" ON "form_step_records"("form_flow_instance_id", "order_index");

-- CreateIndex
CREATE INDEX "generated_pdfs_booking_form_id_idx" ON "generated_pdfs"("booking_form_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_at_idx" ON "audit_logs"("organization_id", "at");

-- CreateIndex
CREATE INDEX "audit_logs_booking_form_id_idx" ON "audit_logs"("booking_form_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "sheet_mirror_jobs_succeeded_at_idx" ON "sheet_mirror_jobs"("succeeded_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_sequences_organization_id_year_key" ON "booking_sequences"("organization_id", "year");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_flow_template_id_fkey" FOREIGN KEY ("flow_template_id") REFERENCES "flow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_flow_template_id_fkey" FOREIGN KEY ("flow_template_id") REFERENCES "flow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tnc_versions" ADD CONSTRAINT "tnc_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_forms" ADD CONSTRAINT "booking_forms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_forms" ADD CONSTRAINT "booking_forms_form_template_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_forms" ADD CONSTRAINT "booking_forms_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_forms" ADD CONSTRAINT "booking_forms_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_forms" ADD CONSTRAINT "booking_forms_tnc_version_id_fkey" FOREIGN KEY ("tnc_version_id") REFERENCES "tnc_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_booking_form_id_fkey" FOREIGN KEY ("booking_form_id") REFERENCES "booking_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_booking_form_id_fkey" FOREIGN KEY ("booking_form_id") REFERENCES "booking_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_documents" ADD CONSTRAINT "form_documents_booking_form_id_fkey" FOREIGN KEY ("booking_form_id") REFERENCES "booking_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_documents" ADD CONSTRAINT "form_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_documents" ADD CONSTRAINT "form_documents_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_documents" ADD CONSTRAINT "form_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_flow_instances" ADD CONSTRAINT "form_flow_instances_booking_form_id_fkey" FOREIGN KEY ("booking_form_id") REFERENCES "booking_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_flow_instances" ADD CONSTRAINT "form_flow_instances_flow_template_id_fkey" FOREIGN KEY ("flow_template_id") REFERENCES "flow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_step_records" ADD CONSTRAINT "form_step_records_form_flow_instance_id_fkey" FOREIGN KEY ("form_flow_instance_id") REFERENCES "form_flow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_step_records" ADD CONSTRAINT "form_step_records_flow_step_id_fkey" FOREIGN KEY ("flow_step_id") REFERENCES "flow_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_step_records" ADD CONSTRAINT "form_step_records_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_step_records" ADD CONSTRAINT "form_step_records_witness_user_id_fkey" FOREIGN KEY ("witness_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_step_records" ADD CONSTRAINT "form_step_records_signature_asset_id_fkey" FOREIGN KEY ("signature_asset_id") REFERENCES "signature_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_signed_by_user_id_fkey" FOREIGN KEY ("signed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_pdfs" ADD CONSTRAINT "generated_pdfs_booking_form_id_fkey" FOREIGN KEY ("booking_form_id") REFERENCES "booking_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_booking_form_id_fkey" FOREIGN KEY ("booking_form_id") REFERENCES "booking_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_mirror_jobs" ADD CONSTRAINT "sheet_mirror_jobs_booking_form_id_fkey" FOREIGN KEY ("booking_form_id") REFERENCES "booking_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
