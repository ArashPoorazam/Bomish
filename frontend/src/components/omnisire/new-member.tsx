"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { MemberForm } from "./members";
import { Workspace, Panel } from "./shared";
import { useStaffPermission } from "../staff/permissions";

export function NewMemberPage() {
  const router = useRouter();
  const can = useStaffPermission();
  const [created, setCreated] = useState("");
  return (
    <Workspace
      owner
      title="همکار جدید"
      actions={
        <Link className="button secondary" href="/omnisire/members">
          <ArrowRight size={18} aria-hidden="true" />
          بازگشت به همکاران
        </Link>
      }
    >
      {can("members.create") ? (
        <Panel title={created ? "حساب آماده است" : "اطلاعات و دسترسی"}>
          {created ? (
            <div className="notice">
              <p>
                حساب همکار آماده است. ورود با نام کاربری و گذرواژه انجام می‌شود.
              </p>
              <Link className="button" href={`/omnisire/members/${created}`}>
                مشاهده پرونده همکار
              </Link>
            </div>
          ) : (
            <MemberForm
              creating
              onCancel={() => router.push("/omnisire/members")}
              onSave={(id) => {
                setCreated(id || "");
              }}
            />
          )}
        </Panel>
      ) : (
        <p className="notice">دسترسی ایجاد همکار برای حساب شما فعال نیست.</p>
      )}
    </Workspace>
  );
}
