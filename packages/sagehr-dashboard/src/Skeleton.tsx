/** Loading placeholder that mirrors the KPI cards + table layout with a shimmer. */
export function DashboardSkeleton() {
  const cols = 4; // approximate policy columns while we don't know the real count
  return (
    <>
      <div className="kpis">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="kpi" key={i}>
            <div className="skel" style={{ width: "55%", height: 24 }} />
            <div className="skel" style={{ width: "40%", marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 240 }}>
                  <div className="skel" style={{ width: 80 }} />
                </th>
                {Array.from({ length: cols }, (_, i) => (
                  <th key={i} className="num">
                    <div className="skel" style={{ width: 70, marginLeft: "auto" }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }, (_, r) => (
                <tr key={r}>
                  <td>
                    <div className="skel" style={{ width: `${55 + ((r * 13) % 35)}%` }} />
                  </td>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c} className="num">
                      <div className="skel" style={{ width: 60, marginLeft: "auto" }} />
                      <div className="skel bar" style={{ width: 60, marginLeft: "auto", marginTop: 6 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
