import {createContext, useState} from "react";
const AtlantContext = createContext({})

// Адрес API: тот же компьютер, с которого открыт сайт
const API = "http://" + window.location.hostname + ":8091"

const AppProvider = ({ children }) => {

    // Полное имя пользователя, например ivanov@users.example.com или Admin@bank.example.com
    const [user, setUser] = useState("")
    const [isAuthorized, setIsAuthorized] = useState(false)

    const login = (name) => {
        setUser(name);
        setIsAuthorized(true);
    };

    const logout = () => {
        setIsAuthorized(false)
        setUser("")
    }

    // Пользователь банка — из организации Bank
    const isBank = user.endsWith("@bank.example.com")

    // Чтение из контракта: GET /contract/<метод>?args=...
    const get = async (method, args = []) => {
        const query = new URLSearchParams(args.map((arg) => ["args", arg]));
        const res = await fetch(`${API}/contract/${method}?${query}`, {
            headers: { Authorization: user },
        });
        const result = await res.json();
        if (!res.ok) {
            throw new Error(result.error);
        }
        return result;
    };

    // Запись в контракт: POST /contract/<метод>, транзакция попадает в блок
    const post = async (method, args = []) => {
        try {
            const res = await fetch(`${API}/contract/${method}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: user,
                },
                body: JSON.stringify({ args: args }),
            });

            const result = await res.json();
            console.log(result);
            if (!res.ok) {
                alert(result.error);
            } else if (result.message) {
                alert(result.message);
            } else {
                alert("успешно");
            }
        } catch  {
            alert("не получилось выполнить транзакцию")
        }
    };


    const values = {
        user,
        isAuthorized,
        isBank,
        login,
        logout,
        get,
        post
    }

    return <AtlantContext.Provider value={values}>{children}</AtlantContext.Provider>
}
export {AppProvider, AtlantContext}
