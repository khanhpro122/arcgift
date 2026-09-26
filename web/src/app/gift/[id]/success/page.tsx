import { SuccessView } from "@/components/SuccessView";
import { networkFromParam } from "@/lib/networks";

export default async function SuccessPage({ params, searchParams }: PageProps<"/gift/[id]/success">) {
  const { id } = await params;
  const query = await searchParams;
  const network = networkFromParam(query.network);
  const tx = typeof query.tx === "string" ? query.tx : undefined;
  return <SuccessView key={network} rawId={id} tx={tx} networkId={network} />;
}
