import { Container, Row, Col, Card, Alert, Button, Table } from "react-bootstrap";
import Header from "../component/Header.jsx";
import { AtlantContext } from "../../core/context.jsx";
import { useContext, useEffect, useState } from "react";
import Authorization from "../component/Authorization.jsx";

const UserInfo = () => {
    const { user, isBank, isDps, isDriver, get, post } = useContext(AtlantContext);
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    // ID штрафа, который сейчас оплачивается: кнопка блокируется до ответа
    const [paying, setPaying] = useState("");

    // Личный кабинет банка или водителя: данные читаются из контракта
    const load = async () => {
        try {
            if (isBank) {
                setData(await get("GetBankAccount"));
            } else if (isDriver) {
                setData(await get("GetMyProfile"));
            }
            setError("");
        } catch (e) {
            setError(e.message);
        }
    };

    // Сменился пользователь: убираем данные прежнего и загружаем свои
    useEffect(() => {
        setData(null);
        if (user) {
            load();
        }
    }, [user]);

    const payFine = async (fineId) => {
        setPaying(fineId);
        await post("PayFine", [fineId]);
        await load();
        setPaying("");
    };

    return (
        <div>
            <Header />
            {!user ? (
                <Authorization />
            ) : (
                <Container>
                    <h2 className="container">Личный кабинет</h2>
                    <Button onClick={load}>обновить</Button>
                    <hr />

                    {error && <Alert variant="warning">{error}</Alert>}

                    {isDps && !isDriver && (
                        <Card className="container">
                            <Card.Body>
                                <Card.Title>Сотрудник ДПС</Card.Title>
                                <p>Выписка штрафов — на странице «функции». Водителем вы не зарегистрированы.</p>
                            </Card.Body>
                        </Card>
                    )}

                    {data && isBank && (
                        <Card className="container">
                            <Card.Body>
                                <Card.Title>Счёт банка: {data.balance} ProfiCoin</Card.Title>
                                <Table>
                                    <thead>
                                        <tr><th>Время</th><th>Плательщик</th><th>Сумма</th></tr>
                                    </thead>
                                    <tbody>
                                        {data.payments.map((payment, index) => (
                                            <tr key={index}>
                                                <td>{new Date(payment.at).toLocaleString()}</td>
                                                <td>{payment.from}</td>
                                                <td>{payment.amount} ProfiCoin</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </Card.Body>
                        </Card>
                    )}

                    {data && isDriver && (
                        <Row>
                            <Col>
                                <Card className="container">
                                    <Card.Body>
                                        <Card.Title>{data.fullName}</Card.Title>
                                        <p>Роль: {isDps ? "сотрудник ДПС и водитель" : "водитель"}</p>
                                        <p>Баланс: {data.balance} ProfiCoin</p>
                                        <p>Стаж: {data.experienceYears} лет (с {data.experienceStartYear})</p>
                                        <p>Неоплаченные штрафы: {data.unpaidFines}</p>
                                        <p>Удостоверение: {data.license
                                            ? `№ ${data.license.number}, категория ${data.license.category}, до ${new Date(data.license.expiresAt).toLocaleDateString()}`
                                            : "нет"}</p>
                                        <p>Транспортные средства: {data.vehicles.length === 0 ? "нет" : data.vehicles
                                            .map((v) => `${v.marketValue} ProfiCoin, ${v.serviceLife} лет`)
                                            .join("; ")}</p>
                                    </Card.Body>
                                </Card>
                            </Col>
                            <Col>
                                <Card className="container">
                                    <Card.Body>
                                        <Card.Title>Штрафы</Card.Title>
                                        {data.fines.length === 0 && <p>Штрафов нет</p>}
                                        {data.fines.map((fine) => (
                                            <div key={fine.id}>
                                                <p>ID: {fine.id}</p>
                                                <p>Выписан: {new Date(fine.issuedAt).toLocaleString()}</p>
                                                {fine.paidAt
                                                    ? <p>Оплачен: {fine.paidAmount} ProfiCoin</p>
                                                    : <Button disabled={paying === fine.id} onClick={() => payFine(fine.id)}>
                                                        {paying === fine.id ? "оплата..." : `оплатить ${fine.currentAmount} ProfiCoin`}
                                                    </Button>}
                                                <hr />
                                            </div>
                                        ))}
                                    </Card.Body>
                                </Card>
                                <Card className="container">
                                    <Card.Body>
                                        <Card.Title>Сообщения</Card.Title>
                                        {data.messages.length === 0 && <p>Сообщений нет</p>}
                                        {data.messages.slice().reverse().map((message, index) => (
                                            <Alert key={index} variant={message.ok ? "success" : "danger"}>
                                                {new Date(message.at).toLocaleString()}: {message.text}
                                            </Alert>
                                        ))}
                                    </Card.Body>
                                </Card>
                            </Col>
                        </Row>
                    )}
                </Container>
            )}
        </div>
    );
};

export default UserInfo;
