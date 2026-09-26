import { ManageView } from "@/components/ManageView";
import { networkFromParam } from "@/lib/networks";

export default async function ManagePage({ params, searchParams }: PageProps<"/gift/[id]/manage">) {
  const { id } = await params;
  const network = networkFromParam((await searchParams).network);
  return <ManageView key={network} rawId={id} networkId={network} />;
}
